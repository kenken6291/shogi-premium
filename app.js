/**
 * Shogi Premium - Game Logic & UI Orchestrator
 */

// --- Firebase Config (ユーザー設定エリア) ---
// ※ユーザーが独自のFirebaseを利用する場合はここを書き換えます
const firebaseConfig = {
  apiKey: "AIzaSyBS64JBBi64ei57PVDR4nLi-fEndQFbpmM",
  authDomain: "shogi-premium.firebaseapp.com",
  databaseURL: "https://shogi-premium-default-rtdb.firebaseio.com",
  projectId: "shogi-premium",
  storageBucket: "shogi-premium.firebasestorage.app",
  messagingSenderId: "260685844",
  appId: "1:260685844:web:3020c343950faa8027a701"
};

// --- Constants ---
const BOARD_SIZE = 9;
const PIECE_NAMES = {
    'P': '歩', 'L': '香', 'N': '桂', 'S': '銀', 'G': '金', 'B': '角', 'R': '飛', 'K': '王',
    '+P': 'と', '+L': '成香', '+N': '成桂', '+S': '成銀', '+B': '馬', '+R': '竜'
};

// --- Audio Synth (Web Audio API) ---
class SoundSynth {
    constructor() {
        this.ctx = null;
        this.muted = false;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    playTone(freq, type, duration, volume, delay = 0) {
        if (this.muted) return;
        this.init();
        
        setTimeout(() => {
            try {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                
                osc.type = type;
                osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
                
                gain.gain.setValueAtTime(volume, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.00001, this.ctx.currentTime + duration);
                
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                
                osc.start();
                osc.stop(this.ctx.currentTime + duration);
            } catch (e) {
                console.error("Audio error", e);
            }
        }, delay * 1000);
    }

    // 将棋駒の「パチッ」という乾いた良い打音をシミュレート
    playPlaceSound() {
        // 主音（中低音のゴンという響き）
        this.playTone(320, 'triangle', 0.08, 0.45);
        // 高調波（パチッというクリック感）
        this.playTone(950, 'sine', 0.02, 0.25);
        // わずかな残響
        this.playTone(180, 'sine', 0.06, 0.2, 0.01);
    }

    playPlaceSoundOnline() {
        // 対戦相手の打鍵音（少し高めのトーン）
        this.playTone(360, 'triangle', 0.08, 0.45);
        this.playTone(1050, 'sine', 0.02, 0.25);
        this.playTone(200, 'sine', 0.06, 0.2, 0.01);
    }

    playWinSound() {
        const chord = [293.66, 349.23, 440.00, 587.33]; // Dm chord ascending
        chord.forEach((freq, idx) => {
            this.playTone(freq, 'sine', 0.4, 0.2, idx * 0.08);
        });
    }

    playLoseSound() {
        const chord = [392.00, 311.13, 261.63, 196.00]; // descending minor
        chord.forEach((freq, idx) => {
            this.playTone(freq, 'sine', 0.5, 0.2, idx * 0.1);
        });
    }
}

const synth = new SoundSynth();

// --- Game State Variables ---
let board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
let hands = {
    black: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
    white: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 }
};
let turn = 'black'; // 'black' (先手) or 'white' (後手)
let gameMode = 'pve'; // 'pvp', 'pve', or 'online'
let aiDifficulty = 'medium'; // 'easy', 'medium', 'hard'
let playerColor = 'black'; // AI戦でプレイヤーが先手か後手か
let gameActive = true;

// UI interaction states
let selectedCell = null; // { r, c }
let selectedHandPiece = null; // { color, pieceType }
let validMovesForSelected = []; // List of { r, c, promoteRequired } for current selected item

// Undo & History
let moveHistory = []; // Stack of { board, hands, turn, lastMove }
let gameRecord = []; // List of moves played: { from, to, piece, promote, isDrop }
let replayMode = false;
let replayIndex = -1;
let replayTimer = null;

// Firebase States
let database = null;
let roomRef = null;
let roomId = null;
let myRole = null; // 'black' (先手) or 'white' (後手)
let isOnlineActive = false;
let oppConnected = false;
let onlineUpdateLock = false;

// Timers
let timerInterval = null;
let timerBlack = 0;
let timerWhite = 0;

// Stats
let gameStats = {
    pvp: { total: 0, blackWins: 0, whiteWins: 0 },
    pve: { total: 0, playerWins: 0, aiWins: 0 },
    online: { total: 0, wins: 0, losses: 0 }
};

// Web Worker for AI
let aiWorker = null;

// --- DOM Elements ---
const boardEl = document.getElementById('board');
const handPiecesBlackEl = document.getElementById('hand-pieces-black');
const handPiecesWhiteEl = document.getElementById('hand-pieces-white');
const statusMessageEl = document.getElementById('status-message');
const nameBlackEl = document.getElementById('name-black');
const nameWhiteEl = document.getElementById('name-white');
const timerBlackEl = document.getElementById('timer-black');
const timerWhiteEl = document.getElementById('timer-white');
const playerBlackCard = document.getElementById('player-black-card');
const playerWhiteCard = document.getElementById('player-white-card');

const selectGameMode = document.getElementById('game-mode');
const selectAiDifficulty = document.getElementById('ai-difficulty');
const selectPlayerColor = document.getElementById('player-color');
const selectTheme = document.getElementById('theme-select');

const btnRestart = document.getElementById('btn-restart');
const btnResign = document.getElementById('btn-resign');
const btnUndo = document.getElementById('btn-undo');
const btnHistory = document.getElementById('btn-history');
const btnMute = document.getElementById('btn-mute');
const svgSoundOn = document.getElementById('svg-sound-on');
const svgSoundOff = document.getElementById('svg-sound-off');

// Online DOM Elements
const onlineRoomGroup = document.getElementById('online-room-group');
const onlineChatGroup = document.getElementById('online-chat-group');
const onlineInitView = document.getElementById('online-init-view');
const onlineWaitingView = document.getElementById('online-waiting-view');
const onlineActiveView = document.getElementById('online-active-view');
const displayRoomId = document.getElementById('display-room-id');
const inputRoomId = document.getElementById('input-room-id');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const btnCopyRoom = document.getElementById('btn-copy-room');
const btnCancelRoom = document.getElementById('btn-cancel-room');
const btnLeaveRoom = document.getElementById('btn-leave-room');

// Modals
const promoteModal = document.getElementById('promote-modal');
const btnPromoteYes = document.getElementById('btn-promote-yes');
const btnPromoteNo = document.getElementById('btn-promote-no');
const previewPromoted = document.getElementById('preview-promoted');
const previewUnpromoted = document.getElementById('preview-unpromoted');

const resultModal = document.getElementById('result-modal');
const winnerTextEl = document.getElementById('winner-text');
const finalStatusDetailsEl = document.getElementById('final-status-details');
const btnModalRestart = document.getElementById('btn-modal-restart');
const btnModalClose = document.getElementById('btn-modal-close');

const historyModal = document.getElementById('history-modal');
const btnHistoryClose = document.getElementById('btn-history-close');
const btnClearStats = document.getElementById('btn-clear-stats');

// Replay controls
const replayPanel = document.getElementById('replay-panel');
const btnReplayPrev = document.getElementById('btn-replay-prev');
const btnReplayNext = document.getElementById('btn-replay-next');
const btnReplayAuto = document.getElementById('btn-replay-auto');
const replayStepsEl = document.getElementById('replay-steps');
const svgPlay = document.getElementById('svg-play');
const svgPause = document.getElementById('svg-pause');

// Chat Overlay
const chatOverlay = document.getElementById('chat-overlay');
const chatBubbleText = document.getElementById('chat-bubble-text');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    initWorker();
    setupEventListeners();
    applyTheme(selectTheme.value);
    resetGame();
});

function initWorker() {
    if (window.Worker) {
        try {
            aiWorker = new Worker('ai-worker.js');
            aiWorker.onmessage = function(e) {
                const { action, move } = e.data;
                if (action === 'move' && move) {
                    // Convert move.from (array [r, c]) to object {r, c} for executeMove
                    const fromObj = move.from ? { r: move.from[0], c: move.from[1] } : null;
                    // Execute COM move
                    setTimeout(() => {
                        executeMove(fromObj, move.to, move.piece, move.promote, move.isDrop);
                    }, 300); // Small natural thinking delay
                } else if (action === 'move' && !move) {
                    // AI resigns
                    endGame(playerColor, "AIが投了しました。");
                }
            };
            aiWorker.onerror = function(err) {
                console.error("AI Worker error:", err);
                statusMessageEl.textContent = "AI思考エンジンでエラーが発生しました。再度お試しください。";
            };
        } catch (e) {
            console.error("Failed to initialize Web Worker:", e);
        }
    } else {
        console.error("Web Workers not supported on this browser!");
    }
}

// --- Sound Mute Handling ---
function toggleMute() {
    synth.muted = !synth.muted;
    if (synth.muted) {
        svgSoundOn.classList.add('hidden');
        svgSoundOff.classList.remove('hidden');
    } else {
        svgSoundOn.classList.remove('hidden');
        svgSoundOff.classList.add('hidden');
        synth.init();
    }
}

// --- Stats Loading ---
function loadStats() {
    const saved = localStorage.getItem('shogi_premium_stats');
    if (saved) {
        try {
            gameStats = JSON.parse(saved);
        } catch (e) {
            console.error("Failed to load stats", e);
        }
    }
    updateStatsDOM();
}

function saveStats() {
    localStorage.setItem('shogi_premium_stats', JSON.stringify(gameStats));
    updateStatsDOM();
}

function updateStatsDOM() {
    document.getElementById('stat-pvp-total').textContent = gameStats.pvp.total;
    document.getElementById('stat-pvp-black-wins').textContent = gameStats.pvp.blackWins;
    document.getElementById('stat-pvp-white-wins').textContent = gameStats.pvp.whiteWins;

    document.getElementById('stat-pve-total').textContent = gameStats.pve.total;
    document.getElementById('stat-pve-player-wins').textContent = gameStats.pve.playerWins;
    document.getElementById('stat-pve-ai-wins').textContent = gameStats.pve.aiWins;

    if (!gameStats.online) {
        gameStats.online = { total: 0, wins: 0, losses: 0 };
    }
    document.getElementById('stat-online-total').textContent = gameStats.online.total;
    document.getElementById('stat-online-wins').textContent = gameStats.online.wins;
    document.getElementById('stat-online-losses').textContent = gameStats.online.losses;
}

function clearStats() {
    if (confirm("すべての対戦成績データを削除してもよろしいですか？")) {
        gameStats = {
            pvp: { total: 0, blackWins: 0, whiteWins: 0 },
            pve: { total: 0, playerWins: 0, aiWins: 0 },
            online: { total: 0, wins: 0, losses: 0 }
        };
        saveStats();
    }
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    btnRestart.addEventListener('click', () => {
        synth.init();
        if (gameMode === 'online') {
            if (confirm("オンライン対戦中の部屋から退出してリセットしますか？")) {
                cleanUpOnlineRoom();
                resetGame();
            }
            return;
        }
        resetGame();
    });

    btnResign.addEventListener('click', () => {
        if (!gameActive) return;
        if (confirm("投了（降参）しますか？")) {
            if (gameMode === 'online') {
                sendResignToFirebase();
            } else {
                const winner = turn === 'black' ? 'white' : 'black';
                endGame(winner, "投了による決着です。");
            }
        }
    });

    btnUndo.addEventListener('click', () => {
        if (gameMode === 'online' || !gameActive) return;
        undoMove();
    });

    btnHistory.addEventListener('click', () => {
        historyModal.classList.remove('hidden');
    });

    btnMute.addEventListener('click', toggleMute);

    selectGameMode.addEventListener('change', (e) => {
        if (gameMode === 'online' && roomRef) {
            if (!confirm("オンライン対戦中の部屋から退出しますか？")) {
                selectGameMode.value = 'online';
                return;
            }
            cleanUpOnlineRoom();
        }

        gameMode = e.target.value;
        const aiGroup = document.getElementById('ai-difficulty-group');
        const colorGroup = document.getElementById('player-color-group');
        
        if (gameMode === 'pvp') {
            aiGroup.classList.add('hidden');
            colorGroup.classList.add('hidden');
            onlineRoomGroup.classList.add('hidden');
            onlineChatGroup.classList.add('hidden');
            btnUndo.classList.remove('hidden');
            resetGame();
        } else if (gameMode === 'pve') {
            aiGroup.classList.remove('hidden');
            colorGroup.classList.remove('hidden');
            onlineRoomGroup.classList.add('hidden');
            onlineChatGroup.classList.add('hidden');
            btnUndo.classList.remove('hidden');
            resetGame();
        } else if (gameMode === 'online') {
            aiGroup.classList.add('hidden');
            colorGroup.classList.add('hidden');
            btnUndo.classList.add('hidden'); // Cannot undo online
            
            if (!initFirebase()) {
                alert("Firebase接続情報が設定されていません。FIREBASE_SETUP.md を読み、app.js の先頭で設定を行ってください。");
                selectGameMode.value = 'pve';
                gameMode = 'pve';
                aiGroup.classList.remove('hidden');
                colorGroup.classList.remove('hidden');
                return;
            }
            
            onlineRoomGroup.classList.remove('hidden');
            showOnlineView('init');
            resetGame();
        }
    });

    selectAiDifficulty.addEventListener('change', (e) => {
        aiDifficulty = e.target.value;
        resetGame();
    });

    selectPlayerColor.addEventListener('change', (e) => {
        playerColor = e.target.value;
        resetGame();
    });

    selectTheme.addEventListener('change', (e) => {
        applyTheme(e.target.value);
    });

    // Modals
    btnModalRestart.addEventListener('click', () => {
        resultModal.classList.add('hidden');
        if (gameMode === 'online') {
            alert("オンライン対局を新しく始めるには、一度退出してから再度部屋を作ってください。");
            return;
        }
        resetGame();
    });
    btnModalClose.addEventListener('click', () => {
        resultModal.classList.add('hidden');
    });
    btnHistoryClose.addEventListener('click', () => {
        historyModal.classList.add('hidden');
    });
    btnClearStats.addEventListener('click', clearStats);

    const tabBtns = historyModal.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const targetId = btn.dataset.tab;
            historyModal.querySelectorAll('.tab-content').forEach(content => {
                if (content.id === targetId) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });

    // Chat preset clicks
    document.querySelectorAll('.btn-chat').forEach(btn => {
        btn.addEventListener('click', () => {
            const msg = btn.getAttribute('data-msg');
            sendChatMessage(msg);
        });
    });

    // Replay controls
    btnReplayPrev.addEventListener('click', () => replayStepTo(replayIndex - 1));
    btnReplayNext.addEventListener('click', () => replayStepTo(replayIndex + 1));
    btnReplayAuto.addEventListener('click', toggleReplayAuto);

    // Online room actions
    btnCreateRoom.addEventListener('click', createOnlineRoom);
    btnJoinRoom.addEventListener('click', () => {
        const rId = inputRoomId.value.trim().toUpperCase();
        if (rId.length !== 6) {
            alert("正しい6桁のルームIDを入力してください。");
            return;
        }
        joinOnlineRoom(rId);
    });
    btnCopyRoom.addEventListener('click', copyRoomIdToClipboard);
    btnCancelRoom.addEventListener('click', cleanUpOnlineRoom);
    btnLeaveRoom.addEventListener('click', cleanUpOnlineRoom);

    // Click event on board (using event delegation)
    boardEl.addEventListener('click', (e) => {
        if (!gameActive || replayMode) return;
        
        // Prevent action if online and not our turn
        if (gameMode === 'online' && (!isOnlineActive || turn !== myRole)) return;
        // Prevent action if COM turn in PvE
        if (gameMode === 'pve' && turn !== playerColor) return;
        
        const cell = e.target.closest('.cell');
        if (!cell) return;
        
        const r = parseInt(cell.dataset.row);
        const c = parseInt(cell.dataset.col);
        
        handleBoardCellClick(r, c);
    });
}

function applyTheme(themeName) {
    document.body.className = '';
    document.body.classList.add(`theme-${themeName}`);
}

// --- Timers Logic ---
function startTimers() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!gameActive || replayMode) return;
        if (gameMode === 'online' && !isOnlineActive) return;
        
        if (turn === 'black') {
            timerBlack++;
            updateTimerDOM(timerBlackEl, timerBlack);
        } else {
            timerWhite++;
            updateTimerDOM(timerWhiteEl, timerWhite);
        }
    }, 1000);
}

function updateTimerDOM(el, seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    el.textContent = `${mins}:${secs}`;
}

function resetTimers() {
    clearInterval(timerInterval);
    timerBlack = 0;
    timerWhite = 0;
    updateTimerDOM(timerBlackEl, 0);
    updateTimerDOM(timerWhiteEl, 0);
}

// --- Game Logic & Rules Engine ---

const INITIAL_BOARD_LAYOUT = [
    [
        { type: 'L', color: 'white', promoted: false },
        { type: 'N', color: 'white', promoted: false },
        { type: 'S', color: 'white', promoted: false },
        { type: 'G', color: 'white', promoted: false },
        { type: 'K', color: 'white', promoted: false },
        { type: 'G', color: 'white', promoted: false },
        { type: 'S', color: 'white', promoted: false },
        { type: 'N', color: 'white', promoted: false },
        { type: 'L', color: 'white', promoted: false }
    ],
    [
        null, { type: 'R', color: 'white', promoted: false }, null, null, null, null, null, { type: 'B', color: 'white', promoted: false }, null
    ],
    [
        { type: 'P', color: 'white', promoted: false },
        { type: 'P', color: 'white', promoted: false },
        { type: 'P', color: 'white', promoted: false },
        { type: 'P', color: 'white', promoted: false },
        { type: 'P', color: 'white', promoted: false },
        { type: 'P', color: 'white', promoted: false },
        { type: 'P', color: 'white', promoted: false },
        { type: 'P', color: 'white', promoted: false },
        { type: 'P', color: 'white', promoted: false }
    ],
    Array(9).fill(null),
    Array(9).fill(null),
    Array(9).fill(null),
    [
        { type: 'P', color: 'black', promoted: false },
        { type: 'P', color: 'black', promoted: false },
        { type: 'P', color: 'black', promoted: false },
        { type: 'P', color: 'black', promoted: false },
        { type: 'P', color: 'black', promoted: false },
        { type: 'P', color: 'black', promoted: false },
        { type: 'P', color: 'black', promoted: false },
        { type: 'P', color: 'black', promoted: false },
        { type: 'P', color: 'black', promoted: false }
    ],
    [
        null, { type: 'B', color: 'black', promoted: false }, null, null, null, null, null, { type: 'R', color: 'black', promoted: false }, null
    ],
    [
        { type: 'L', color: 'black', promoted: false },
        { type: 'N', color: 'black', promoted: false },
        { type: 'S', color: 'black', promoted: false },
        { type: 'G', color: 'black', promoted: false },
        { type: 'K', color: 'black', promoted: false },
        { type: 'G', color: 'black', promoted: false },
        { type: 'S', color: 'black', promoted: false },
        { type: 'N', color: 'black', promoted: false },
        { type: 'L', color: 'black', promoted: false }
    ]
];

function resetGame() {
    // Clone initial board layout
    board = INITIAL_BOARD_LAYOUT.map(row => row.map(cell => cell ? { ...cell } : null));
    
    // Clear hands
    hands = {
        black: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
        white: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 }
    };
    
    turn = 'black';
    gameActive = true;
    moveHistory = [];
    gameRecord = [];
    replayMode = false;
    replayIndex = -1;
    clearInterval(replayTimer);
    
    selectedCell = null;
    selectedHandPiece = null;
    validMovesForSelected = [];
    
    btnUndo.disabled = true;
    btnResign.disabled = false;
    replayPanel.classList.add('hidden');
    
    gameMode = selectGameMode.value;
    aiDifficulty = selectAiDifficulty.value;
    playerColor = selectPlayerColor.value;
    
    if (gameMode === 'pvp') {
        nameBlackEl.textContent = 'プレイヤー1 (先手)';
        nameWhiteEl.textContent = 'プレイヤー2 (後手)';
        resetTimers();
        startTimers();
    } else if (gameMode === 'pve') {
        if (playerColor === 'black') {
            nameBlackEl.textContent = 'あなた (先手)';
            nameWhiteEl.textContent = 'AI (後手)';
        } else {
            nameBlackEl.textContent = 'AI (先手)';
            nameWhiteEl.textContent = 'あなた (後手)';
        }
        resetTimers();
        startTimers();
    } else if (gameMode === 'online') {
        onlineChatGroup.classList.remove('hidden');
        if (myRole === 'black') {
            nameBlackEl.textContent = 'あなた (先手)';
            nameWhiteEl.textContent = oppConnected ? '対戦相手 (後手)' : '待機中...';
        } else if (myRole === 'white') {
            nameBlackEl.textContent = '対戦相手 (先手)';
            nameWhiteEl.textContent = 'あなた (後手)';
        } else {
            nameBlackEl.textContent = '先手';
            nameWhiteEl.textContent = '後手';
        }
        resetTimers();
        if (isOnlineActive) {
            startTimers();
        }
    }
    
    renderBoard();
    renderHands();
    updateUI();
    
    // If COM starts first
    if (gameMode === 'pve' && playerColor === 'white') {
        triggerAiMove();
    }
}

function cloneBoard(src) {
    return src.map(row => row.map(cell => cell ? { ...cell } : null));
}

function cloneHands(src) {
    return {
        black: { ...src.black },
        white: { ...src.white }
    };
}

function saveHistory(lastMove = null) {
    moveHistory.push({
        board: cloneBoard(board),
        hands: cloneHands(hands),
        turn: turn,
        timerBlack: timerBlack,
        timerWhite: timerWhite,
        gameActive: gameActive,
        lastMove: lastMove
    });
    btnUndo.disabled = false;
}

function undoMove() {
    if (moveHistory.length === 0) return;
    
    let state = moveHistory.pop();
    // If PvE, undo BOTH AI and player moves (2 pops)
    if (gameMode === 'pve' && moveHistory.length > 0) {
        state = moveHistory.pop(); // Pop player state
    }
    
    board = state.board;
    hands = state.hands;
    turn = state.turn;
    timerBlack = state.timerBlack;
    timerWhite = state.timerWhite;
    gameActive = state.gameActive;
    
    // Remove last move from record
    gameRecord.pop();
    if (gameMode === 'pve') gameRecord.pop();
    
    selectedCell = null;
    selectedHandPiece = null;
    validMovesForSelected = [];
    
    if (moveHistory.length === 0) {
        btnUndo.disabled = true;
    }
    
    renderBoard();
    renderHands();
    updateUI();
}

// --- DOM Rendering ---

function renderBoard() {
    const isMarker = (r, c) => {
        // Shogi star markers are located at (3, 3), (3, 6), (6, 3), (6, 6) (1-indexed: 4,4, 4,7, 7,4, 7,7)
        return (r === 3 || r === 6) && (c === 3 || c === 6);
    };
    
    // Generate cells once if empty
    if (boardEl.children.length === 0) {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = r;
                cell.dataset.col = c;
                if (isMarker(r, c)) {
                    cell.classList.add('marker');
                }
                boardEl.appendChild(cell);
            }
        }
    }
    
    // Render each cell
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = boardEl.children[r * BOARD_SIZE + c];
            const piece = board[r][c];
            
            // Clean up highlight states
            cell.className = isMarker(r, c) ? 'cell marker' : 'cell';
            
            // Highlight last move
            if (gameRecord.length > 0) {
                const lastMove = gameRecord[gameRecord.length - 1];
                if (lastMove.to[0] === r && lastMove.to[1] === c) {
                    cell.classList.add('last-move');
                }
            }
            
            // Highlight selected cell
            if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
                cell.classList.add('selected');
            }
            
            // Highlight valid movement hints
            const isHint = validMovesForSelected.some(vm => vm.r === r && vm.c === c);
            if (isHint) {
                cell.classList.add('hint');
            }
            
            // Draw piece
            let pieceEl = cell.querySelector('.shogi-piece');
            if (piece) {
                const displayName = PIECE_NAMES[(piece.promoted ? '+' : '') + piece.type];
                
                if (!pieceEl) {
                    pieceEl = document.createElement('div');
                    pieceEl.className = `shogi-piece ${piece.color}`;
                    pieceEl.dataset.type = piece.type;
                    
                    const textEl = document.createElement('span');
                    textEl.className = 'piece-text';
                    textEl.textContent = displayName;
                    
                    pieceEl.appendChild(textEl);
                    cell.appendChild(pieceEl);
                } else {
                    pieceEl.className = `shogi-piece ${piece.color}`;
                    if (piece.promoted) pieceEl.classList.add('promoted');
                    pieceEl.dataset.type = piece.type;
                    pieceEl.querySelector('.piece-text').textContent = displayName;
                }
                
                // Add class for slam animation if last placed
                if (gameRecord.length > 0) {
                    const lastMove = gameRecord[gameRecord.length - 1];
                    if (lastMove.to[0] === r && lastMove.to[1] === c && !replayMode) {
                        pieceEl.classList.add('placed');
                    }
                }
            } else {
                if (pieceEl) {
                    pieceEl.remove();
                }
            }
        }
    }
}

function renderHands() {
    // Renders the piece panels for black and white
    const renderHandForColor = (color, container) => {
        container.innerHTML = '';
        const playerHands = hands[color];
        
        // Show pieces in specific priority order
        const pieceTypes = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
        
        pieceTypes.forEach(type => {
            const count = playerHands[type];
            if (count <= 0) return;
            
            const item = document.createElement('div');
            item.className = 'hand-piece-item';
            item.dataset.type = type;
            item.dataset.color = color;
            
            const pieceMarkup = document.createElement('div');
            // Show as sub-rotated piece if opponent
            pieceMarkup.className = `shogi-piece ${color}`;
            pieceMarkup.dataset.type = type;
            
            const textSpan = document.createElement('span');
            textSpan.className = 'piece-text';
            textSpan.textContent = PIECE_NAMES[type];
            
            pieceMarkup.appendChild(textSpan);
            item.appendChild(pieceMarkup);
            
            const countBadge = document.createElement('span');
            countBadge.className = 'hand-piece-count';
            countBadge.textContent = count;
            
            item.appendChild(countBadge);
            container.appendChild(item);
            
            // Click to drop piece
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!gameActive || replayMode) return;
                if (gameMode === 'online' && turn !== myRole) return;
                if (gameMode === 'pve' && turn !== playerColor) return;
                
                if (selectedHandPiece && selectedHandPiece.pieceType === type && selectedHandPiece.color === color) {
                    // Deselect
                    selectedHandPiece = null;
                    validMovesForSelected = [];
                } else {
                    selectedCell = null;
                    selectedHandPiece = { color, pieceType: type };
                    // Calculate drop places
                    validMovesForSelected = getDropMovesForType(board, hands, color, type);
                }
                
                // Clear active selected hand items highlights
                document.querySelectorAll('.hand-piece-item').forEach(el => el.classList.remove('selected'));
                if (selectedHandPiece) {
                    item.classList.add('selected');
                }
                
                renderBoard();
            });
        });
    };
    
    renderHandForColor('black', handPiecesBlackEl);
    renderHandForColor('white', handPiecesWhiteEl);
}

function updateUI() {
    if (turn === 'black') {
        playerBlackCard.classList.add('active');
        playerWhiteCard.classList.remove('active');
        statusMessageEl.textContent = `${nameBlackEl.textContent}の手番です (👑)`;
    } else {
        playerBlackCard.classList.remove('active');
        playerWhiteCard.classList.add('active');
        statusMessageEl.textContent = `${nameWhiteEl.textContent}の手番です (☖)`;
    }
    
    // Check if own king is in check (王手)
    const ownKingInCheck = isUnderCheck(board, turn);
    if (ownKingInCheck) {
        statusMessageEl.textContent += "【王手！】";
        statusMessageEl.classList.add('check-warning');
    } else {
        statusMessageEl.classList.remove('check-warning');
    }
    
    const isAiThinking = gameActive && gameMode === 'pve' && turn !== playerColor && !replayMode;
    if (isAiThinking) {
        if (turn === 'black') {
            playerBlackCard.querySelector('.thinking-spinner').classList.remove('hidden');
        } else {
            playerWhiteCard.querySelector('.thinking-spinner').classList.remove('hidden');
        }
        statusMessageEl.textContent = "AIが考え中です...";
    } else {
        playerBlackCard.querySelector('.thinking-spinner').classList.add('hidden');
        playerWhiteCard.querySelector('.thinking-spinner').classList.add('hidden');
    }
}

// --- Interaction Handlers ---

function handleBoardCellClick(r, c) {
    const clickedPiece = board[r][c];
    
    // 1. If hint is clicked, execute move!
    const isMoveExec = validMovesForSelected.some(vm => vm.r === r && vm.c === c);
    if (isMoveExec) {
        const targetMove = validMovesForSelected.find(vm => vm.r === r && vm.c === c);
        
        if (selectedHandPiece) {
            // Drop piece
            executeMove(null, [r, c], selectedHandPiece.pieceType, false, true);
        } else if (selectedCell) {
            const fromPiece = board[selectedCell.r][selectedCell.c];
            
            // Check Promotion Choices
            const canPromote = checkPromotionOption(selectedCell.r, r, fromPiece);
            
            if (canPromote.option) {
                if (canPromote.force) {
                    // Force promote
                    executeMove(selectedCell, [r, c], fromPiece.type, true, false);
                } else {
                    // Ask user via Promote Modal
                    showPromoteModal(fromPiece.type, (choice) => {
                        executeMove(selectedCell, [r, c], fromPiece.type, choice, false);
                    });
                }
            } else {
                executeMove(selectedCell, [r, c], fromPiece.type, false, false);
            }
        }
        return;
    }
    
    // 2. Select Piece on board
    if (clickedPiece && clickedPiece.color === turn) {
        selectedHandPiece = null;
        document.querySelectorAll('.hand-piece-item').forEach(el => el.classList.remove('selected'));
        
        if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
            // Deselect
            selectedCell = null;
            validMovesForSelected = [];
        } else {
            selectedCell = { r, c };
            // Calculate legal moves for this piece
            validMovesForSelected = getLegalMovesForCell(board, hands, turn, r, c);
        }
        
        renderBoard();
        return;
    }
    
    // 3. Clicked empty space or opponent without hint (Deselect)
    selectedCell = null;
    selectedHandPiece = null;
    validMovesForSelected = [];
    document.querySelectorAll('.hand-piece-item').forEach(el => el.classList.remove('selected'));
    renderBoard();
}

function checkPromotionOption(fromRow, toRow, piece) {
    const isPromoZone = (row) => piece.color === 'black' ? row <= 2 : row >= 6;
    const canPromote = (isPromoZone(fromRow) || isPromoZone(toRow)) && 
                       ['P', 'L', 'N', 'S', 'B', 'R'].includes(piece.type) && 
                       !piece.promoted;
                       
    if (!canPromote) return { option: false, force: false };
    
    // Forced promotion when no moves left
    let force = false;
    if (piece.type === 'P' || piece.type === 'L') {
        force = (piece.color === 'black' && toRow === 0) || (piece.color === 'white' && toRow === 8);
    } else if (piece.type === 'N') {
        force = (piece.color === 'black' && toRow <= 1) || (piece.color === 'white' && toRow >= 7);
    }
    
    return { option: true, force };
}

function showPromoteModal(pieceType, callback) {
    previewUnpromoted.textContent = PIECE_NAMES[pieceType];
    previewPromoted.textContent = PIECE_NAMES['+' + pieceType];
    
    promoteModal.classList.remove('hidden');
    
    const cleanup = () => {
        promoteModal.classList.add('hidden');
        btnPromoteYes.removeEventListener('click', onYes);
        btnPromoteNo.removeEventListener('click', onNo);
    };
    
    const onYes = () => {
        cleanup();
        callback(true);
    };
    
    const onNo = () => {
        cleanup();
        callback(false);
    };
    
    btnPromoteYes.addEventListener('click', onYes);
    btnPromoteNo.addEventListener('click', onNo);
}

// --- Execute & Sync Moves ---

function executeMove(from, to, pieceType, promote, isDrop, isFromOnlineSync = false) {
    if (!isFromOnlineSync) {
        saveHistory({ from, to, pieceType, promote, isDrop });
    }
    
    if (isDrop) {
        // Place piece
        board[to[0]][to[1]] = { type: pieceType, color: turn, promoted: false };
        hands[turn][pieceType]--;
    } else {
        const dest = board[to[0]][to[1]];
        if (dest) {
            // Captured! Put in hand (always demoted)
            const basicType = dest.type.replace('+', '');
            hands[turn][basicType]++;
        }
        
        // Move
        const pObj = board[from.r][from.c];
        board[to[0]][to[1]] = pObj;
        board[from.r][from.c] = null;
        
        if (promote) {
            pObj.promoted = true;
        }
    }
    
    // Add to game record
    gameRecord.push({
        from: from ? [from.r, from.c] : null,
        to,
        piece: pieceType,
        promote,
        isDrop
    });
    
    if (isFromOnlineSync) {
        synth.playPlaceSoundOnline();
    } else {
        synth.playPlaceSound();
    }
    
    // Clear selection
    selectedCell = null;
    selectedHandPiece = null;
    validMovesForSelected = [];
    
    renderBoard();
    renderHands();
    
    // Check game termination (Checkmate)
    const nextTurn = turn === 'black' ? 'white' : 'black';
    const nextLegalMoves = getLegalMovesAll(board, hands, nextTurn);
    
    if (nextLegalMoves.length === 0) {
        // Checkmate! The current turn wins
        setTimeout(() => {
            endGame(turn, isUnderCheck(board, nextTurn) ? "詰みによる決着です。" : "合法手がありません（ステイルメイト）。");
        }, 300);
        return;
    }
    
    // Switch turn
    turn = nextTurn;
    updateUI();
    
    // Online sync
    if (gameMode === 'online' && !isFromOnlineSync) {
        sendMoveToFirebase(from, to, pieceType, promote, isDrop);
    }
    
    // Trigger COM move if next turn is AI
    if (gameMode === 'pve' && turn !== playerColor && gameActive) {
        triggerAiMove();
    }
}

function triggerAiMove() {
    if (!aiWorker) return;
    
    aiWorker.postMessage({
        action: 'move',
        board,
        hands,
        aiColor: turn,
        difficulty: aiDifficulty
    });
}

function endGame(winner, reason) {
    gameActive = false;
    clearInterval(timerInterval);
    btnResign.disabled = true;
    
    // Show winner dialog
    if (winner === 'black') {
        winnerTextEl.textContent = `${nameBlackEl.textContent} の勝ち！ 👑`;
    } else {
        winnerTextEl.textContent = `${nameWhiteEl.textContent} の勝ち！ 👑`;
    }
    
    finalStatusDetailsEl.textContent = reason;
    resultModal.classList.remove('hidden');
    
    // Sound FX
    if (gameMode === 'pve') {
        if (winner === playerColor) {
            synth.playWinSound();
        } else {
            synth.playLoseSound();
        }
    } else if (gameMode === 'online') {
        if (winner === myRole) {
            synth.playWinSound();
        } else {
            synth.playLoseSound();
        }
    } else {
        synth.playWinSound();
    }
    
    // Save Stats
    if (gameMode === 'pvp') {
        gameStats.pvp.total++;
        if (winner === 'black') gameStats.pvp.blackWins++;
        else gameStats.pvp.whiteWins++;
    } else if (gameMode === 'pve') {
        gameStats.pve.total++;
        if (winner === playerColor) gameStats.pve.playerWins++;
        else gameStats.pve.aiWins++;
    } else if (gameMode === 'online') {
        gameStats.online.total++;
        if (winner === myRole) gameStats.online.wins++;
        else gameStats.online.losses++;
        
        // Update room status in firebase
        if (roomRef && !onlineUpdateLock) {
            roomRef.update({
                status: 'finished',
                winner: winner,
                endReason: reason
            });
        }
    }
    saveStats();
    
    // Show replay panel
    replayPanel.classList.remove('hidden');
    replayIndex = gameRecord.length;
    updateReplayDOM();
}

// --- Rules Checking Logic (Mirrors Worker) ---

function isUnderCheck(boardState, color) {
    // Find King
    let kr = -1, kc = -1;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const p = boardState[r][c];
            if (p && p.type === 'K' && p.color === color) {
                kr = r;
                kc = c;
                break;
            }
        }
        if (kr !== -1) break;
    }
    if (kr === -1) return false;
    
    const oppColor = color === 'black' ? 'white' : 'black';
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const p = boardState[r][c];
            if (p && p.color === oppColor) {
                const moves = getRawPieceMoves(boardState, r, c);
                for (const m of moves) {
                    if (m.to[0] === kr && m.to[1] === kc) return true;
                }
            }
        }
    }
    return false;
}

function getRawPieceMoves(boardState, r, c) {
    const piece = boardState[r][c];
    if (!piece) return [];
    
    const moves = [];
    const color = piece.color;
    const type = piece.type;
    const promoted = piece.promoted;
    
    const dir = color === 'black' ? -1 : 1;
    
    const addMove = (tr, tc) => {
        if (tr >= 0 && tr < BOARD_SIZE && tc >= 0 && tc < BOARD_SIZE) {
            const dest = boardState[tr][tc];
            if (!dest || dest.color !== color) {
                moves.push({ to: [tr, tc] });
                return !dest; // Continue slide if empty
            }
        }
        return false;
    };
    
    const addSlide = (dr, dc) => {
        let step = 1;
        while (true) {
            if (!addMove(r + dr * step, c + dc * step)) break;
            step++;
        }
    };
    
    // Movements
    if (type === 'P' && !promoted) {
        addMove(r + dir, c);
    } else if (type === 'L' && !promoted) {
        addSlide(dir, 0);
    } else if (type === 'N' && !promoted) {
        addMove(r + dir * 2, c - 1);
        addMove(r + dir * 2, c + 1);
    } else if (type === 'S' && !promoted) {
        addMove(r + dir, c);
        addMove(r + dir, c - 1);
        addMove(r + dir, c + 1);
        addMove(r - dir, c - 1);
        addMove(r - dir, c + 1);
    } else if (type === 'G' || (['P','L','N','S'].includes(type) && promoted)) {
        addMove(r + dir, c);
        addMove(r + dir, c - 1);
        addMove(r + dir, c + 1);
        addMove(r, c - 1);
        addMove(r, c + 1);
        addMove(r - dir, c);
    } else if (type === 'B') {
        addSlide(1, 1); addSlide(1, -1); addSlide(-1, 1); addSlide(-1, -1);
        if (promoted) {
            addMove(r+1, c); addMove(r-1, c); addMove(r, c+1); addMove(r, c-1);
        }
    } else if (type === 'R') {
        addSlide(1, 0); addSlide(-1, 0); addSlide(0, 1); addSlide(0, -1);
        if (promoted) {
            addMove(r+1, c+1); addMove(r+1, c-1); addMove(r-1, c+1); addMove(r-1, c-1);
        }
    } else if (type === 'K') {
        const steps = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        steps.forEach(s => addMove(r + s[0], c + s[1]));
    }
    
    return moves;
}

function getLegalMovesForCell(boardState, handsState, color, r, c) {
    const rawMoves = getRawPieceMoves(boardState, r, c);
    const legal = [];
    
    rawMoves.forEach(m => {
        // Simulate
        const temp = cloneBoard(boardState);
        temp[m.to[0]][m.to[1]] = temp[r][c];
        temp[r][c] = null;
        
        if (!isUnderCheck(temp, color)) {
            legal.push({ r: m.to[0], c: m.to[1] });
        }
    });
    
    return legal;
}

function getDropMovesForType(boardState, handsState, color, type) {
    const moves = [];
    const pawnCols = new Set();
    
    if (type === 'P') {
        for (let c = 0; c < BOARD_SIZE; c++) {
            let hasP = false;
            for (let r = 0; r < BOARD_SIZE; r++) {
                const p = boardState[r][c];
                if (p && p.type === 'P' && !p.promoted && p.color === color) {
                    hasP = true;
                    break;
                }
            }
            if (hasP) pawnCols.add(c);
        }
    }
    
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (boardState[r][c]) continue;
            
            // Rules
            if (type === 'P' || type === 'L') {
                if ((color === 'black' && r === 0) || (color === 'white' && r === 8)) continue;
            }
            if (type === 'N') {
                if ((color === 'black' && r <= 1) || (color === 'white' && r >= 7)) continue;
            }
            if (type === 'P' && pawnCols.has(c)) continue;
            
            // Simulate to ensure not checkmate if Uchifuzume
            const temp = cloneBoard(boardState);
            temp[r][c] = { type, color, promoted: false };
            
            if (isUnderCheck(temp, color)) continue;
            
            // Uchifuzume check
            if (type === 'P') {
                const oppColor = color === 'black' ? 'white' : 'black';
                if (isUnderCheck(temp, oppColor)) {
                    // Check if opponent is checkmated
                    const oppLegal = getLegalMovesAll(temp, handsState, oppColor);
                    if (oppLegal.length === 0) continue; // Illegal
                }
            }
            
            moves.push({ r, c });
        }
    }
    
    return moves;
}

function getLegalMovesAll(boardState, handsState, color) {
    const moves = [];
    
    // Board moves
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const p = boardState[r][c];
            if (p && p.color === color) {
                const pMoves = getLegalMovesForCell(boardState, handsState, color, r, c);
                pMoves.forEach(m => moves.push({ from: [r, c], to: [m.r, m.c], isDrop: false }));
            }
        }
    }
    
    // Hand drops
    const types = ['P', 'L', 'N', 'S', 'G', 'B', 'R'];
    types.forEach(type => {
        if (handsState[color][type] > 0) {
            const dMoves = getDropMovesForType(boardState, handsState, color, type);
            dMoves.forEach(m => moves.push({ from: null, to: [m.r, m.c], piece: type, isDrop: true }));
        }
    });
    
    return moves;
}

// --- Replay Mode Handlers ---

function updateReplayDOM() {
    replayStepsEl.textContent = `${replayIndex} / ${gameRecord.length}`;
}

function replayStepTo(idx) {
    if (idx < 0 || idx > gameRecord.length) return;
    
    replayIndex = idx;
    updateReplayDOM();
    
    // Reconstruct board and hand from history
    if (idx === 0) {
        board = INITIAL_BOARD_LAYOUT.map(row => row.map(cell => cell ? { ...cell } : null));
        hands = {
            black: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
            white: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 }
        };
        turn = 'black';
    } else {
        const state = moveHistory[idx - 1];
        board = cloneBoard(state.board);
        hands = cloneHands(state.hands);
        
        // Re-apply the target move itself
        const move = gameRecord[idx - 1];
        if (move.isDrop) {
            board[move.to[0]][move.to[1]] = { type: move.piece, color: state.turn, promoted: false };
            hands[state.turn][move.piece]--;
        } else {
            const dest = board[move.to[0]][move.to[1]];
            if (dest) {
                const basic = dest.type.replace('+', '');
                hands[state.turn][basic]++;
            }
            board[move.to[0]][move.to[1]] = board[move.from[0]][move.from[1]];
            board[move.from[0]][move.from[1]] = null;
            if (move.promote) {
                board[move.to[0]][move.to[1]].promoted = true;
            }
        }
        turn = state.turn === 'black' ? 'white' : 'black';
    }
    
    replayMode = true;
    renderBoard();
    renderHands();
}

function toggleReplayAuto() {
    if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
        svgPlay.classList.remove('hidden');
        svgPause.classList.add('hidden');
    } else {
        svgPlay.classList.add('hidden');
        svgPause.classList.remove('hidden');
        replayTimer = setInterval(() => {
            if (replayIndex >= gameRecord.length) {
                toggleReplayAuto(); // Stop auto replay
                return;
            }
            replayStepTo(replayIndex + 1);
        }, 1200);
    }
}

// --- Firebase Multiplayer Integration ---

function initFirebase() {
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        database = firebase.database();
        return true;
    } catch (e) {
        console.error("Firebase init failed", e);
        return false;
    }
}

function showOnlineView(viewState) {
    onlineInitView.classList.add('hidden');
    onlineWaitingView.classList.add('hidden');
    onlineActiveView.classList.add('hidden');
    
    if (viewState === 'init') {
        onlineInitView.classList.remove('hidden');
    } else if (viewState === 'waiting') {
        onlineWaitingView.classList.remove('hidden');
    } else if (viewState === 'active') {
        onlineActiveView.classList.remove('hidden');
    }
}

function createOnlineRoom() {
    synth.init();
    roomId = generateRandomRoomId();
    displayRoomId.textContent = roomId;
    
    myRole = 'black'; // Creator is Black (先手)
    isOnlineActive = false;
    oppConnected = false;
    onlineUpdateLock = false;
    
    roomRef = database.ref('rooms/' + roomId);
    roomRef.set({
        status: 'waiting',
        turn: 'black',
        players: {
            black: { name: 'あなた', active: true },
            white: { name: '待機中...', active: false }
        },
        moves: [],
        lastUpdated: firebase.database.ServerValue.TIMESTAMP
    });
    
    // Listen for room changes
    roomRef.on('value', handleRoomUpdate);
    
    // Set active listeners for disconnect
    database.ref('rooms/' + roomId + '/players/black/active').onDisconnect().set(false);
    
    showOnlineView('waiting');
}

function joinOnlineRoom(rId) {
    synth.init();
    roomId = rId;
    
    myRole = 'white'; // Joiner is White (後手)
    isOnlineActive = false;
    oppConnected = false;
    onlineUpdateLock = false;
    
    roomRef = database.ref('rooms/' + roomId);
    roomRef.once('value').then(snapshot => {
        if (!snapshot.exists()) {
            alert("指定されたルームIDが存在しません。");
            return;
        }
        
        const data = snapshot.val();
        if (data.status !== 'waiting') {
            alert("このルームはすでに満室か、対局が開始されています。");
            return;
        }
        
        // Update player info
        roomRef.update({
            status: 'playing',
            'players/white': { name: '対戦相手', active: true },
            lastUpdated: firebase.database.ServerValue.TIMESTAMP
        });
        
        // Listen
        roomRef.on('value', handleRoomUpdate);
        
        // Disconnect hook
        database.ref('rooms/' + roomId + '/players/white/active').onDisconnect().set(false);
        
        showOnlineView('active');
        resetGame();
    });
}

function handleRoomUpdate(snapshot) {
    if (!snapshot.exists()) return;
    
    const data = snapshot.val();
    
    // Handle player status changes
    if (data.status === 'playing') {
        if (!isOnlineActive) {
            isOnlineActive = true;
            oppConnected = true;
            showOnlineView('active');
            
            // Name setups
            if (myRole === 'black') {
                nameBlackEl.textContent = 'あなた (先手)';
                nameWhiteEl.textContent = '対戦相手 (後手)';
            } else {
                nameBlackEl.textContent = '対戦相手 (先手)';
                nameWhiteEl.textContent = 'あなた (後手)';
            }
            startTimers();
            updateUI();
        }
        
        // Connection drops
        const isBlackActive = data.players?.black?.active;
        const isWhiteActive = data.players?.white?.active;
        
        if (myRole === 'black' && !isWhiteActive && oppConnected) {
            oppConnected = false;
            statusMessageEl.textContent = "対戦相手の切断を検知しました...";
        } else if (myRole === 'white' && !isBlackActive && oppConnected) {
            oppConnected = false;
            statusMessageEl.textContent = "対戦相手の切断を検知しました...";
        }
    }
    
    // Sync moves
    if (data.moves) {
        const movesList = Object.values(data.moves);
        if (movesList.length > gameRecord.length) {
            const nextMove = movesList[gameRecord.length];
            const isMyMove = (myRole === 'black' && gameRecord.length % 2 === 0) || 
                             (myRole === 'white' && gameRecord.length % 2 === 1);
            
            if (!isMyMove) {
                // Opponent's move, execute locally
                onlineUpdateLock = true;
                const fromObj = nextMove.from ? { r: nextMove.from[0], c: nextMove.from[1] } : null;
                executeMove(fromObj, nextMove.to, nextMove.piece, nextMove.promote, nextMove.isDrop, true);
                onlineUpdateLock = false;
            }
        }
    }
    
    // Sync Chat Overlay
    if (data.chat) {
        const chatList = Object.values(data.chat);
        const lastChat = chatList[chatList.length - 1];
        
        // Show bubble if within last 5 seconds
        const age = Date.now() - lastChat.time;
        if (age < 5000 && lastChat.sender !== myRole) {
            showChatBubble(lastChat.text);
        }
    }
    
    // Sync Resignation or Finished
    if (data.status === 'finished' && gameActive) {
        gameActive = false;
        clearInterval(timerInterval);
        btnResign.disabled = true;
        
        winnerTextEl.textContent = data.winner === myRole ? "あなたの勝ち！ 🎉" : "あなたの負け... 🙇‍♂️";
        finalStatusDetailsEl.textContent = data.endReason || "ゲームが終了しました。";
        resultModal.classList.remove('hidden');
        
        if (data.winner === myRole) {
            synth.playWinSound();
        } else {
            synth.playLoseSound();
        }
        
        // Update stats once
        gameStats.online.total++;
        if (data.winner === myRole) gameStats.online.wins++;
        else gameStats.online.losses++;
        saveStats();
        
        replayPanel.classList.remove('hidden');
        replayIndex = gameRecord.length;
        updateReplayDOM();
    }
}

function sendMoveToFirebase(from, to, piece, promote, isDrop) {
    if (!roomRef || onlineUpdateLock) return;
    
    const moveObj = {
        from: from ? [from.r, from.c] : null,
        to,
        piece,
        promote,
        isDrop,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };
    
    roomRef.child('moves').push(moveObj);
    roomRef.update({
        turn: turn === 'black' ? 'white' : 'black',
        lastUpdated: firebase.database.ServerValue.TIMESTAMP
    });
}

function sendResignToFirebase() {
    if (!roomRef) return;
    
    const winner = myRole === 'black' ? 'white' : 'black';
    roomRef.update({
        status: 'finished',
        winner: winner,
        endReason: '相手の投了による対局終了です。'
    });
}

function cleanUpOnlineRoom() {
    if (roomRef) {
        // If we are creator, destroy room, otherwise just set our active false
        roomRef.off();
        if (myRole === 'black') {
            roomRef.remove();
        } else {
            roomRef.child('players/white/active').set(false);
        }
        roomRef = null;
    }
    
    roomId = null;
    myRole = null;
    isOnlineActive = false;
    oppConnected = false;
    
    showOnlineView('init');
    onlineChatGroup.classList.add('hidden');
    resetGame();
}

function sendChatMessage(text) {
    if (!roomRef) return;
    
    const chatMsg = {
        sender: myRole,
        text: text,
        time: firebase.database.ServerValue.TIMESTAMP
    };
    
    roomRef.child('chat').push(chatMsg);
    // Display locally too
    showChatBubble(text, true);
}

function showChatBubble(text, isSelf = false) {
    chatBubbleText.textContent = (isSelf ? "あなた: " : "相手: ") + text;
    chatOverlay.classList.remove('hidden');
    
    // Clear previous timer if exists
    if (chatOverlay.fadeTimer) {
        clearTimeout(chatOverlay.fadeTimer);
    }
    
    chatOverlay.fadeTimer = setTimeout(() => {
        chatOverlay.classList.add('hidden');
    }, 4000);
}

function copyRoomIdToClipboard() {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId).then(() => {
        alert("ルームIDをクリップボードにコピーしました！");
    }).catch(e => {
        console.error("Copy failed", e);
    });
}

function generateRandomRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
