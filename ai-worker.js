/**
 * Shogi Premium - AI Thinking Engine (Web Worker)
 */

self.onmessage = function(e) {
    const { action, board, hands, aiColor, difficulty } = e.data;
    
    if (action === 'move') {
        const bestMove = calculateBestMove(board, hands, aiColor, difficulty);
        self.postMessage({ action: 'move', move: bestMove });
    }
};

// --- Constants ---
const BOARD_SIZE = 9;

// Material Values
const VALUES = {
    'P': 100,  'L': 250,  'N': 350,  'S': 500,  'G': 600,  'B': 800,  'R': 1000, 'K': 100000,
    '+P': 300, '+L': 450, '+N': 550, '+S': 600,            '+B': 950, '+R': 1150
};

// Piece value in hand (slightly different from board for trade flexibility)
const HAND_VALUES = {
    'P': 110, 'L': 270, 'N': 380, 'S': 530, 'G': 630, 'B': 850, 'R': 1050
};

// Positional Tables for evaluation (from Black perspective, row 0 is far, row 8 is near)
// For White, we invert the row index
const POSITION_BONUS = {
    'P': [
        [30, 30, 30, 30, 30, 30, 30, 30, 30],
        [20, 20, 20, 20, 20, 20, 20, 20, 20],
        [10, 15, 15, 20, 20, 20, 15, 15, 10],
        [ 5,  5, 10, 15, 15, 15, 10,  5,  5],
        [ 2,  2,  5, 10, 10, 10,  5,  2,  2],
        [ 0,  0,  2,  5,  5,  5,  2,  0,  0],
        [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
        [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
        [ 0,  0,  0,  0,  0,  0,  0,  0,  0]
    ],
    'K': [
        [-50, -50, -50, -50, -50, -50, -50, -50, -50],
        [-40, -40, -40, -40, -40, -40, -40, -40, -40],
        [-30, -30, -30, -30, -30, -30, -30, -30, -30],
        [-25, -25, -25, -25, -25, -25, -25, -25, -25],
        [-20, -20, -20, -20, -20, -20, -20, -20, -20],
        [-10, -10, -10, -10, -10, -10, -10, -10, -10],
        [  0,   0,   0, -10, -10, -10,   0,   0,   0],
        [ 10,  20,  10,   0,   0,   0,  10,  20,  10],
        [ 20,  30,  15,   0,   0,   0,  15,  30,  20]
    ]
};

// --- Shogi Rule Logic ---

function cloneBoard(board) {
    return board.map(row => row.map(cell => cell ? { ...cell } : null));
}

function cloneHands(hands) {
    return {
        black: { ...hands.black },
        white: { ...hands.white }
    };
}

// Get raw physical moves for a piece on the board (ignoring check safety)
function getPieceMoves(board, r, c) {
    const piece = board[r][c];
    if (!piece) return [];
    
    const moves = [];
    const color = piece.color;
    const type = piece.type;
    const promoted = piece.promoted;
    
    // Direction modifier: Black moves up (negative r), White moves down (positive r)
    const dir = color === 'black' ? -1 : 1;
    
    // Helper to add jump or sliding moves
    const addMove = (tr, tc) => {
        if (tr >= 0 && tr < BOARD_SIZE && tc >= 0 && tc < BOARD_SIZE) {
            const dest = board[tr][tc];
            if (!dest) {
                moves.push({ from: [r, c], to: [tr, tc], promote: false });
                return true; // continue sliding
            } else if (dest.color !== color) {
                moves.push({ from: [r, c], to: [tr, tc], promote: false });
                return false; // block slide but capture is possible
            }
        }
        return false; // out of bounds or blocked by ally
    };
    
    const addSlide = (dr, dc) => {
        let step = 1;
        while (true) {
            const tr = r + dr * step;
            const tc = c + dc * step;
            const canContinue = addMove(tr, tc);
            if (!canContinue) break;
            step++;
        }
    };
    
    // Moves depending on piece type
    if (type === 'P' && !promoted) {
        // Pawn: 1 step forward
        addMove(r + dir, c);
    }
    else if (type === 'L' && !promoted) {
        // Lance: forward sliding
        addSlide(dir, 0);
    }
    else if (type === 'N' && !promoted) {
        // Knight: L-shape forward
        addMove(r + dir * 2, c - 1);
        addMove(r + dir * 2, c + 1);
    }
    else if (type === 'S' && !promoted) {
        // Silver: 5 directions (diag forward, straight forward, diag backward)
        addMove(r + dir, c);
        addMove(r + dir, c - 1);
        addMove(r + dir, c + 1);
        addMove(r - dir, c - 1);
        addMove(r - dir, c + 1);
    }
    else if (type === 'G' || (['P', 'L', 'N', 'S'].includes(type) && promoted)) {
        // Gold General & Promoted Minor Pieces (と, 成香, 成桂, 成銀)
        // 6 directions: front, front-left, front-right, left, right, back
        addMove(r + dir, c);
        addMove(r + dir, c - 1);
        addMove(r + dir, c + 1);
        addMove(r, c - 1);
        addMove(r, c + 1);
        addMove(r - dir, c);
    }
    else if (type === 'B') {
        // Bishop: 4 diags sliding
        addSlide(1, 1);
        addSlide(1, -1);
        addSlide(-1, 1);
        addSlide(-1, -1);
        
        if (promoted) {
            // Dragon Horse (+B) extra: King moves (ortho 1 step)
            addMove(r + 1, c);
            addMove(r - 1, c);
            addMove(r, c + 1);
            addMove(r, c - 1);
        }
    }
    else if (type === 'R') {
        // Rook: 4 ortho sliding
        addSlide(1, 0);
        addSlide(-1, 0);
        addSlide(0, 1);
        addSlide(0, -1);
        
        if (promoted) {
            // Promoted Rook (+R) extra: King moves (diag 1 step)
            addMove(r + 1, c + 1);
            addMove(r + 1, c - 1);
            addMove(r - 1, c + 1);
            addMove(r - 1, c - 1);
        }
    }
    else if (type === 'K') {
        // King: All 8 directions, 1 step
        const steps = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],           [0, 1],
            [1, -1],  [1, 0],  [1, 1]
        ];
        steps.forEach(s => addMove(r + s[0], c + s[1]));
    }
    
    // Add promotion flag to choices where applicable
    // Promotion zone: top 3 rows for Black (0,1,2), bottom 3 rows for White (6,7,8)
    const isPromoZone = (row) => color === 'black' ? row <= 2 : row >= 6;
    
    const finalMoves = [];
    moves.forEach(m => {
        const toRow = m.to[0];
        const canPromote = (isPromoZone(r) || isPromoZone(toRow)) && 
                           ['P', 'L', 'N', 'S', 'B', 'R'].includes(type) && 
                           !promoted;
                           
        if (canPromote) {
            // Force promote if piece cannot move from the new position
            let forcePromote = false;
            if (type === 'P' || type === 'L') {
                forcePromote = (color === 'black' && toRow === 0) || (color === 'white' && toRow === 8);
            } else if (type === 'N') {
                forcePromote = (color === 'black' && toRow <= 1) || (color === 'white' && toRow >= 7);
            }
            
            if (forcePromote) {
                finalMoves.push({ ...m, promote: true });
            } else {
                finalMoves.push({ ...m, promote: false });
                finalMoves.push({ ...m, promote: true });
            }
        } else {
            finalMoves.push(m);
        }
    });
    
    return finalMoves;
}

// Check if a specific player's King is under attack
function isCheck(board, color) {
    // Find King's position
    let kr = -1, kc = -1;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (piece && piece.type === 'K' && piece.color === color) {
                kr = r;
                kc = c;
                break;
            }
        }
        if (kr !== -1) break;
    }
    
    if (kr === -1) return false; // King not on board (should not happen in real play)
    
    // Check if any opponent piece can reach the King
    const oppColor = color === 'black' ? 'white' : 'black';
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (piece && piece.color === oppColor) {
                const moves = getPieceMoves(board, r, c);
                for (const m of moves) {
                    if (m.to[0] === kr && m.to[1] === kc) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

// Generate all drop moves for hand pieces
function getDropMoves(board, hands, color) {
    const moves = [];
    const playerHands = hands[color];
    const emptyCells = [];
    
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (!board[r][c]) {
                emptyCells.push([r, c]);
            }
        }
    }
    
    // Cache Pawn column counts to prevent Nifu (二歩)
    const pawnCols = new Set();
    if (playerHands['P'] > 0) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            let hasPawn = false;
            for (let r = 0; r < BOARD_SIZE; r++) {
                const piece = board[r][c];
                if (piece && piece.type === 'P' && !piece.promoted && piece.color === color) {
                    hasPawn = true;
                    break;
                }
            }
            if (hasPawn) {
                pawnCols.add(c);
            }
        }
    }
    
    // For each piece in hand
    for (const pieceType in playerHands) {
        if (playerHands[pieceType] <= 0) continue;
        
        for (const [r, c] of emptyCells) {
            // Rule checks
            
            // 1. 行き所のない駒の禁止 (No dead end drop)
            if (pieceType === 'P' || pieceType === 'L') {
                if ((color === 'black' && r === 0) || (color === 'white' && r === 8)) continue;
            }
            if (pieceType === 'N') {
                if ((color === 'black' && r <= 1) || (color === 'white' && r >= 7)) continue;
            }
            
            // 2. 二歩の禁止 (Nifu)
            if (pieceType === 'P' && pawnCols.has(c)) continue;
            
            // 3. 打ち歩詰めの禁止 (Uchifuzume)
            // (Only filter out if it actually checkmates opponent King, checked in legal moves generator)
            
            moves.push({
                from: null,
                to: [r, c],
                piece: pieceType,
                promote: false,
                isDrop: true
            });
        }
    }
    
    return moves;
}

// Generate all legal moves (moves + drops) that resolve or do not cause check
function getLegalMoves(board, hands, color) {
    const rawMoves = [];
    
    // 1. Board moves
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (piece && piece.color === color) {
                rawMoves.push(...getPieceMoves(board, r, c));
            }
        }
    }
    
    // 2. Drop moves
    rawMoves.push(...getDropMoves(board, hands, color));
    
    // Filter out moves that leave own King in check
    const legalMoves = [];
    
    rawMoves.forEach(m => {
        // Simulate move
        const tempBoard = cloneBoard(board);
        const tempHands = cloneHands(hands);
        
        let captured = null;
        
        if (m.isDrop) {
            tempBoard[m.to[0]][m.to[1]] = { type: m.piece, color, promoted: false };
            tempHands[color][m.piece]--;
        } else {
            const [fr, fc] = m.from;
            const [tr, tc] = m.to;
            const piece = tempBoard[fr][fc];
            
            captured = tempBoard[tr][tc];
            
            // Move piece
            tempBoard[tr][tc] = piece;
            tempBoard[fr][fc] = null;
            
            if (m.promote) {
                piece.promoted = true;
            }
        }
        
        // Check if our king is in check after this move
        if (!isCheck(tempBoard, color)) {
            
            // Check Uchifuzume (打ち歩詰め)
            // If drop is Pawn, and it causes check, we must ensure it is not checkmate
            if (m.isDrop && m.piece === 'P') {
                const oppColor = color === 'black' ? 'white' : 'black';
                if (isCheck(tempBoard, oppColor)) {
                    // Check if opponent has ANY legal moves in this simulated board
                    const oppLegalMoves = getLegalMovesCheckOnly(tempBoard, tempHands, oppColor);
                    if (oppLegalMoves.length === 0) {
                        // It is checkmate, so this Pawn drop is illegal (Uchifuzume)
                        return;
                    }
                }
            }
            
            legalMoves.push(m);
        }
    });
    
    return legalMoves;
}

// Light version of legal moves check to avoid infinite loops during Uchifuzume check
function getLegalMovesCheckOnly(board, hands, color) {
    const rawMoves = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (piece && piece.color === color) {
                rawMoves.push(...getPieceMoves(board, r, c));
            }
        }
    }
    rawMoves.push(...getDropMoves(board, hands, color));
    
    const legalMoves = [];
    rawMoves.forEach(m => {
        const tempBoard = cloneBoard(board);
        if (m.isDrop) {
            tempBoard[m.to[0]][m.to[1]] = { type: m.piece, color, promoted: false };
        } else {
            const [fr, fc] = m.from;
            const [tr, tc] = m.to;
            tempBoard[tr][tc] = tempBoard[fr][fc];
            tempBoard[fr][fc] = null;
            if (m.promote) tempBoard[tr][tc].promoted = true;
        }
        if (!isCheck(tempBoard, color)) {
            legalMoves.push(m);
        }
    });
    return legalMoves;
}

// --- Position and Board Evaluation ---

function evaluateBoard(board, hands, aiColor) {
    let score = 0;
    const oppColor = aiColor === 'black' ? 'white' : 'black';
    
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            
            // 1. Material score
            const pieceKey = (piece.promoted ? '+' : '') + piece.type;
            const materialValue = VALUES[pieceKey] || 0;
            
            // 2. Position bonus (especially for Pawns and King)
            let posBonus = 0;
            if (piece.type === 'P' && !piece.promoted) {
                const evalRow = piece.color === 'black' ? r : (BOARD_SIZE - 1 - r);
                posBonus = POSITION_BONUS['P'][evalRow][c] || 0;
            } else if (piece.type === 'K') {
                const evalRow = piece.color === 'black' ? r : (BOARD_SIZE - 1 - r);
                posBonus = POSITION_BONUS['K'][evalRow][c] || 0;
            }
            
            // Accumulate
            if (piece.color === aiColor) {
                score += materialValue + posBonus;
            } else {
                score -= (materialValue + posBonus);
            }
        }
    }
    
    // 3. Hand value evaluation
    for (const type in hands[aiColor]) {
        score += hands[aiColor][type] * HAND_VALUES[type];
    }
    for (const type in hands[oppColor]) {
        score -= hands[oppColor][type] * HAND_VALUES[type];
    }
    
    return score;
}

// --- Search Algorithms ---

function calculateBestMove(board, hands, aiColor, difficulty) {
    const legalMoves = getLegalMoves(board, hands, aiColor);
    
    if (legalMoves.length === 0) {
        return null; // resign or checkmate
    }
    
    // Easy mode: Highly random or random nodes
    if (difficulty === 'easy') {
        // 35% chance to play completely random legal move
        if (Math.random() < 0.35) {
            return legalMoves[Math.floor(Math.random() * legalMoves.length)];
        }
        
        // Otherwise, 1-step depth minimax with large noise
        let bestScore = -Infinity;
        let candidates = [];
        
        legalMoves.forEach(m => {
            const simulated = simulateMove(board, hands, m, aiColor);
            const baseScore = evaluateBoard(simulated.board, simulated.hands, aiColor);
            const noise = (Math.random() - 0.5) * 400; // Large noise
            const score = baseScore + noise;
            
            if (score > bestScore) {
                bestScore = score;
                candidates = [m];
            } else if (score === bestScore) {
                candidates.push(m);
            }
        });
        
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
    
    // Medium mode: Depth 2 minimax (AI move -> human response) with mild noise
    if (difficulty === 'medium') {
        let bestScore = -Infinity;
        let candidates = [];
        
        legalMoves.forEach(m => {
            const simulated = simulateMove(board, hands, m, aiColor);
            // Opponent's turn (minimize our score)
            const oppColor = aiColor === 'black' ? 'white' : 'black';
            const oppMoves = getLegalMoves(simulated.board, simulated.hands, oppColor);
            
            let minOppScore = Infinity;
            
            if (oppMoves.length === 0) {
                // We checkmated opponent
                minOppScore = 90000;
            } else {
                oppMoves.forEach(om => {
                    const oppSim = simulateMove(simulated.board, simulated.hands, om, oppColor);
                    const score = evaluateBoard(oppSim.board, oppSim.hands, aiColor);
                    if (score < minOppScore) {
                        minOppScore = score;
                    }
                });
            }
            
            const noise = (Math.random() - 0.5) * 60; // Soft noise for variety
            const finalScore = minOppScore + noise;
            
            if (finalScore > bestScore) {
                bestScore = finalScore;
                candidates = [m];
            } else if (Math.abs(finalScore - bestScore) < 5) {
                candidates.push(m);
            }
        });
        
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
    
    // Hard mode: Depth 3 Alpha-Beta search (AI move -> human -> AI)
    if (difficulty === 'hard') {
        let bestScore = -Infinity;
        let candidates = [];
        
        // Depth 3 search
        const DEPTH = 3;
        
        legalMoves.forEach(m => {
            const simulated = simulateMove(board, hands, m, aiColor);
            const score = alphaBeta(simulated.board, simulated.hands, DEPTH - 1, -Infinity, Infinity, false, aiColor);
            
            if (score > bestScore) {
                bestScore = score;
                candidates = [m];
            } else if (score === bestScore) {
                candidates.push(m);
            }
        });
        
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
    
    return legalMoves[0];
}

// Alpha-Beta minimax search function
function alphaBeta(board, hands, depth, alpha, beta, isMaximizing, aiColor) {
    const activeColor = isMaximizing ? aiColor : (aiColor === 'black' ? 'white' : 'black');
    const legalMoves = getLegalMoves(board, hands, activeColor);
    
    if (depth === 0 || legalMoves.length === 0) {
        return evaluateBoard(board, hands, aiColor);
    }
    
    if (isMaximizing) {
        let maxEval = -Infinity;
        for (const m of legalMoves) {
            const sim = simulateMove(board, hands, m, activeColor);
            const evaluation = alphaBeta(sim.board, sim.hands, depth - 1, alpha, beta, false, aiColor);
            maxEval = Math.max(maxEval, evaluation);
            alpha = Math.max(alpha, evaluation);
            if (beta <= alpha) break; // Beta cut-off
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const m of legalMoves) {
            const sim = simulateMove(board, hands, m, activeColor);
            const evaluation = alphaBeta(sim.board, sim.hands, depth - 1, alpha, beta, true, aiColor);
            minEval = Math.min(minEval, evaluation);
            beta = Math.min(beta, evaluation);
            if (beta <= alpha) break; // Alpha cut-off
        }
        return minEval;
    }
}

// Helper to simulate a move and return the new board/hands states
function simulateMove(board, hands, m, color) {
    const tempBoard = cloneBoard(board);
    const tempHands = cloneHands(hands);
    
    if (m.isDrop) {
        tempBoard[m.to[0]][m.to[1]] = { type: m.piece, color, promoted: false };
        tempHands[color][m.piece]--;
    } else {
        const [fr, fc] = m.from;
        const [tr, tc] = m.to;
        const piece = tempBoard[fr][fc];
        
        const dest = tempBoard[tr][tc];
        if (dest) {
            // Captured! Add to hand
            let capturedType = dest.type;
            // Promoted pieces revert to basic form in hand
            const basicType = capturedType.replace('+', '');
            tempHands[color][basicType]++;
        }
        
        // Move piece
        tempBoard[tr][tc] = piece;
        tempBoard[fr][fc] = null;
        
        if (m.promote) {
            piece.promoted = true;
        }
    }
    
    return { board: tempBoard, hands: tempHands };
}
