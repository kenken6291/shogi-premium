# Firebase Realtime Database セットアップ手順

将棋プレミアム（Shogi Premium）でオンライン通信対戦機能を利用するには、無料のGoogle Firebaseアカウントを作成し、データベースを設定する必要があります。
以下の手順に沿って設定を行ってください。

---

## 🛠️ ステップ1: Firebaseプロジェクトの作成

1. [Firebase Console](https://console.firebase.google.com/) にアクセスし、Googleアカウントでログインします。
2. 「**プロジェクトを追加**」をクリックします。
3. プロジェクト名（例: `shogi-premium`）を入力し、規約に同意して「続行」を押します。
4. Google アナリティクスは不要なため、無効化して「**プロジェクトを作成**」をクリックします。
5. 作成完了画面が表示されたら「続行」をクリックします。

---

## 🛠️ ステップ2: Realtime Database の作成とルール設定

オンライン対戦でリアルタイムに指し手やチャットのデータを同期するためのデータベースを作成します。

1. Firebaseコンソールの左側メニューから「**構築**」をクリックし、「**Realtime Database**」を選択します。
2. 「**データベースを作成**」をクリックします。
3. データベースの場所（ロケーション）を選択します（デフォルトの「米国」または「アジア」で問題ありません）。「次へ」を押します。
4. セキュリティルールの初期設定で「**テストモードで開始する**」を選択します。
   > [!IMPORTANT]
   > テストモードは30日後にアクセスできなくなります。永続的に利用したい場合は、作成後に「ルール」タブを開き、以下のように書き換えて「公開」をクリックしてください。
   > ```json
   > {
   >   "rules": {
   >     ".read": true,
   >     ".write": true
   >   }
   > }
   > ```
5. 「**有効にする**」をクリックします。

---

## 🛠️ ステップ3: アプリの登録と設定のコピー

データベースの接続情報をゲームに埋め込むためのAPIキー等を取得します。

1. Firebaseコンソールの左メニュー上部にある「**プロジェクトの概要**」の横の「歯車マーク」をクリックし、「**プロジェクトの設定**」を選択します。
2. 下部にある「マイアプリ」セクションで、**ウェブ（ `</>` アイコン）** をクリックします。
3. アプリのニックネーム（例: `shogi-web`）を入力します。※「Firebase Hosting」のチェックは**不要**です。
4. 「**アプリを登録**」をクリックします。
5. 画面に設定用のコード（SDKの追加）が表示されます。その中にある `firebaseConfig` オブジェクトをコピーします。

```javascript
// コピーする対象の例：
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "shogi-premium.firebaseapp.com",
  databaseURL: "https://shogi-premium-default-rtdb.firebaseio.com",
  projectId: "shogi-premium",
  storageBucket: "shogi-premium.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

---

## 🛠️ ステップ4: `app.js` への貼り付け

1. ローカルの `shogi-premium/app.js` をエディタで開きます。
2. ファイルの先頭付近にある以下の部分を探します：

```javascript
// --- Firebase Config (ユーザー設定エリア) ---
const firebaseConfig = {
    // ⚠️ コピーした firebaseConfig の中身をここに貼り付けてください
};
```

3. コピーした接続情報をここに貼り付けて保存します。
4. ファイルを保存し、再び Git にコミットして GitHub にプッシュすれば、オンライン対戦がすぐに使えるようになります！
5. 設定していない場合は、自動的にオフラインの「練習戦 (VS COM)」モードのみが起動します。
