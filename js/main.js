// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getDatabase, ref, push, set, onChildAdded, update, remove, onChildRemoved, onChildChanged, runTransaction }
    from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

import { firebaseConfig } from "/js/firebase-config-secrets.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig); //firebaseの初期化
const db = getDatabase(app); //realtimeDBに接続する
const dbRef = ref(db, "chat"); //realtimeDB内の"アプリ名"

// --- [1] DOM要素の定義と初期設定 ---
// DOM要素（HTMLの部品）をJavaScriptで操作できるように取得します
const fabButton = document.querySelector('#fab-open-modal');
const modal = document.querySelector('#creation-modal');
const modalClose = document.querySelector('#modal-close-button');
const createForm = document.querySelector('#create-auction-form');
const cardsContainer = document.querySelector('#auction-cards-container'); // カード一覧の親要素

// FAP (Floating Action Panel) の要素
const fapPanel = document.querySelector('#floating-bid-panel');
const fapCountdownDisplay = document.querySelector('#fap-countdown');
const fapBidForm = document.querySelector('#fap-bid-form');
const fapBidInput = document.querySelector('#fap-bid-input');
const fapBidButton = document.querySelector('#fap-bid-button');
const fapCloseButton = document.querySelector('#fap-close-button');
const fapBidderNameInput = document.querySelector('#fap-bidder-name');


// 選択中のオークションID（FAPの入札対象）
let selectedAuctionId = null;

// カウントダウンタイマーを管理するオブジェクト
const timers = {};


// --- [2] モーダル表示/非表示ロジック ---

// FABクリックでモーダルを表示
fabButton.addEventListener('click', () => {
    modal.classList.remove('hidden'); // hiddenクラスを削除して表示
    document.body.style.overflow = 'hidden'; // 背景のスクロールを一時的に無効
});

// 閉じるボタンでモーダルを非表示
modalClose.addEventListener('click', () => {
    modal.classList.add('hidden'); // hiddenクラスを追加して非表示
    document.body.style.overflow = ''; // スクロールを元に戻す
});

// 背景クリックで閉じる機能
modal.addEventListener('click', (e) => {
    // クリックされた要素がモーダル背景自身 (creation-modal) か確認
    if (e.target.id === 'creation-modal') {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }
});


// --- [3] 新規出品ロジック (Create: C) ---

createForm.addEventListener('submit', function (e) {
    e.preventDefault(); // フォームのデフォルトの送信動作（ページ遷移）を停止

    // フォームから値を取得
    const productName = document.querySelector('#productName').value;
    const productDescription = document.querySelector('#productDescription').value;
    let minPrice = parseInt(document.querySelector('#minPrice').value, 10);
    const auctionDurationHours = parseInt(document.querySelector('#auctionDuration').value, 10);

    // 最低価格の100円単位チェック
    if (minPrice % 100 !== 0) {
        alert('最低価格は100円単位で入力してください。');
        return; // 処理を中断
    }

    // 現在時刻 + (入力された時間数 * 60分 * 60秒 * 1000ミリ秒)
    const endDateTimestamp = new Date().getTime() + (auctionDurationHours * 60 * 60 * 1000);

    // 出品データオブジェクトの作成
    const newItem = {
        name: productName,
        description: productDescription,
        minPrice: minPrice,
        currentPrice: minPrice, //初期価格は最低価格
        bidCount: 0,
        endTime: endDateTimestamp, // 終了時刻 (ミリ秒)
        highestBidder: '出品者', 
    };

    //Firebase RB にデータをプッシュ
    push(dbRef, newItem)
        .then(() => {
            modal.classList.add('hidden');
            document.body.style.overflow = "";
            createForm.reset();
            alert('オークションに出品しました！');
        })
        .catch((error) => {
            console.error("出品エラー：", error);
            alert('出品に失敗しました。')
        });


    // モーダルを非表示にし、フォームをリセット
    // modal.classList.add('hidden');
    // document.body.style.overflow = '';
    // createForm.reset();

    // alert('オークションを出品しました！');
});


// --- [4] オークションカード描画ロジック (Read: R) ---

// 受け取ったデータを元に、DOM要素（カード）を生成する関数
function createAuctionCard(item) {
    const card = document.createElement('div');
    card.className = 'col-4 product-card card';
    card.setAttribute('data-product-id', item.id);

    // toLocaleString() で数字を「12,345」のように見やすくフォーマット
    const currentPriceFormatted = item.currentPrice.toLocaleString();

    card.innerHTML = `
        <h3>${item.name}</h3>
        <p class="product-description">${item.description || '説明なし'}</p>
        <div class="auction-status">
            <p><strong>現在価格: </strong><span class="current-price-display">¥${currentPriceFormatted}</span></p>
            <p><strong>入札数: </strong><span class="bid-count-display">${item.bidCount}</span>件</p>
            <p><strong>最高入札者: </strong><span class="highest-bidder-display">${item.highestBidder || 'なし'}</span></p>
            <p><strong>残り時間: </strong><span id="timer-${item.id}" class="timer-display-list">計算中...</span></p>
            <button class="bid-select-button submit-button" data-id="${item.id}">入札を選択</button>
        </div>
    `;

    // 入札選択ボタンにイベントリスナーを設定
    const selectButton = card.querySelector('.bid-select-button');
    selectButton.addEventListener('click', () => {
        selectedAuctionId = item.id;

        // FAP (入札パネル) の表示をこのアイテムの情報に更新
        updateFAP(item);

        // FAPを表示（CSSで制御）
        fapPanel.style.display = 'block';
    });

    return card;
}


// ----------------------------------------------------
// 【メイン機能】カウントダウンと入札終了処理
// ----------------------------------------------------

onChildAdded(dbRef, (snapshot) => {
    const itemData = snapshot.val();
    const itemId = snapshot.key;
    const item = {
        id: itemId, // カードの特定に使用するキー
        ...itemData
        // idと一緒に新しいitemオブジェクトの直下に展開（スプレッド構文 ...）することで、フラットな構造に
        // name, minPrice, currentPrice, endTime など全て
    };

    const cardElement = createAuctionCard(item); //カード生成

    cardsContainer.prepend(cardElement); // 最新が上に来るようにprepend

    if (timers[itemId]) {
        clearInterval(timers[itemId]);
    }

    const timerDisplayElement = cardElement.querySelector(`#timer-${itemId}`);// IDセレクタ内に変数を埋め込むため、バッククォート ` を使用
    timers[itemId] = startCountdown(item.endTime, timerDisplayElement, itemId);
});


onChildChanged(dbRef, (snapshot) => {
    const itemData = snapshot.val();
    const itemId = snapshot.key;

    const updatedItem = {
        id: itemId,
        ...itemData
    };

    updateCardUI(updatedItem);

    if (selectedAuctionId === itemId) {
        updateFAP(updatedItem);
    }

});



onChildRemoved(dbRef, (snapshot) => {
    const itemId = snapshot.key;

    // UIから該当アイテムのカードを削除
    const cardElement = document.querySelector(`.product-card[data-product-id="${itemId}"]`);
    if (cardElement) {
        cardElement.remove();

        // タイマーを停止
        if (timers[itemId]) {
            clearInterval(timers[itemId]);
            delete timers[itemId];
        }
    }
});




function startCountdown(endDate, displayElement, itemId) {

    // 1000ミリ秒（1秒）ごとに実行されるタイマーをセット
    const intervalId = setInterval(updateCountdown, 1000);

    function updateCountdown() {
        const now = new Date().getTime(); // 現在時刻（ミリ秒）
        const distance = endDate - now; // 残り時間（ミリ秒）

        // 【条件分岐】残り時間が0以下になったら
        if (distance < 0) {
            clearInterval(intervalId); // タイマーを停止
            displayElement.textContent = 'オークション終了！';

            handleAuctionEnd(itemId); // 終了後の処理を実行

            // FAPが入札終了アイテムを表示していたら非表示にする
            if (selectedAuctionId === itemId) {
                fapPanel.style.display = 'none';
                selectedAuctionId = null;
            }
            return;
        }

        // 時間の計算（ミリ秒から日、時、分、秒への変換）
        const second = 1000;
        const minute = second * 60;
        const hour = minute * 60;

        // Math.floor() で小数点以下を切り捨てて正確な時間を算出
        const hours = Math.floor(distance / hour); // 24時間以上の時間もそのまま表示
        const minutes = Math.floor((distance % hour) / minute);
        const seconds = Math.floor((distance % minute) / second);

        // 結果を表示（ゼロパディング: 1桁の数字を01のように2桁にする）
        const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        displayElement.textContent = formattedTime;

        // 残り時間が30分を切ったら緊急スタイルを適用
        const thirtyMinutes = 30 * 60 * 1000;
        if (distance < thirtyMinutes) {
            displayElement.classList.add('timer-urgent');
        } else {
            displayElement.classList.remove('timer-urgent');
        }

        // FAPが表示されている場合、そのカウントダウンも更新
        if (selectedAuctionId === itemId) {
            fapCountdownDisplay.textContent = formattedTime;
            // FAPのタイマーにも緊急スタイルを適用
            if (distance < thirtyMinutes) {
                fapCountdownDisplay.classList.add('timer-urgent');
            } else {
                fapCountdownDisplay.classList.remove('timer-urgent');
            }
        }
    }

    // カウントダウン表示をすぐに開始
    updateCountdown();

    return intervalId; // タイマーIDを返して後で停止できるようにする
}

// ----------------------------------------------------
// 【メイン機能】オークション終了時の処理
// ----------------------------------------------------

function handleAuctionEnd(itemId) {
    // 終了したアイテムのカード要素を取得
    const cardElement = document.querySelector(`.product-card[data-product-id="${itemId}"]`);
    if (!cardElement) return;

    // 入札ボタンを「オークション終了」表示に切り替え
    const selectButton = cardElement.querySelector('.bid-select-button');
    if (selectButton) {
        selectButton.textContent = '終了しました';
        selectButton.disabled = true;
        selectButton.style.backgroundColor = '#6c757d';
    }

    // 削除ボタンの追加（終了後の出品者向け機能）
    const deleteButton = document.createElement('button');
    deleteButton.textContent = '商品を削除する';
    deleteButton.className = 'submit-button delete-button';
    deleteButton.style.backgroundColor = '#dc3545';
    deleteButton.style.marginTop = '10px';

    // 削除ボタンのクリックイベントを設定 (Delete: D)
    deleteButton.addEventListener('click', () => {
        if (confirm('本当にこのオークションアイテムを削除しますか？')) {
            const itemRef = ref(db, `chat/${itemId}`);

            remove(itemRef)
                .then(() => {
                    alert('アイテムを削除しました。');
                })
                .catch((error) => {
                    console.error("削除エラー:", error);
                    alert('削除に失敗しました。');
                });
        }
    });

    // カードのステータスエリアに削除ボタンを追加
    const statusArea = cardElement.querySelector('.auction-status');
    statusArea.appendChild(deleteButton);
}


// --- [5] 入札ロジック (Update: U) ---

// FAPの情報を更新する関数
function updateFAP(item) {
    // FAPの入札ボタンを有効化
    fapBidButton.disabled = false;

    // 次の最低入札額を計算 (現在価格 + 100円)
    const nextMinBid = item.currentPrice + 100;

    // 入力欄の属性を更新
    fapBidInput.min = nextMinBid; // HTML側での最低入札額を更新
    fapBidInput.value = nextMinBid; // 入力欄に初期値をセット
}

// 入札フォームの送信イベント
// fapBidForm.addEventListener('submit', function (e) {
//     e.preventDefault();

//     let bidAmount = parseInt(fapBidInput.value, 10);

//     // 現在選択中のアイテムをデータストアから検索
//     const cardElement = document.querySelector(`.product-card[data-product-id="${selectedAuctionId}"]`);
//     if (!cardElement) return ;

//     // DOMから現在の価格と入札数を取得
//     const currentPriceText = cardElement.querySelector('.current-price-display').textContent.replace('¥', '').replace(/,/g, '');
//     const currentPrice = parseInt(currentPriceText, 10);
//     const currentBidCount = parseInt(cardElement.querySelector('.bid-count-display').textContent, 10);

//     // 入札額のバリデーション
//     const nextMinBid = currentPrice + 100;

//     // 1. 選択アイテムの存在チェック
//     // 2. 入札額が現在の最高額 + 100円に達しているかチェック
//     // 3. **100円単位**で入力されているかチェック
//     if (!selectedAuctionId || bidAmount < nextMinBid || bidAmount % 100 !== 0) {
//         alert(`無効な入札額です。\n・最低入札額: ¥${nextMinBid.toLocaleString()}以上\n・入札額は100円単位である必要があります。`);
//         fapBidInput.value = nextMinBid; // 無効なら正しい値に戻す
//         return;
//     }

//     // データストアの値を更新
//     const itemRef = ref(db, `chat/${selectedAuctionId}`);

//     const updateData = {
//         currentPrice: bidAmount,
//         bidCount: currentBidCount + 1, // 現在の値に1を加算してDBに送信
//     };

//     // update関数で指定したフィールドのみを部分的に更新
//     update(itemRef, updateData)
//         .then(() => {
//             // 成功時: UIを即時更新し、UXを向上させる
//             updateCardUI({ id: selectedAuctionId, ...updateData });
//             updateFAP({ currentPrice: updateData.currentPrice });
//             alert(`¥${bidAmount.toLocaleString()}で入札しました！`);
//         })
//         .catch((error) => {
//             console.error("入札エラー:", error);
//             alert('入札に失敗しました。');
//         });
// });

fapBidForm.addEventListener('submit', function (e) {
    e.preventDefault();

    let bidAmount = parseInt(fapBidInput.value, 10);
    
    // DOMからの currentPrice 取得を削除。DBのトランザクションに任せる
    const bidderName = fapBidderNameInput.value.trim() || '匿名'; // 入札者名を取得、または匿名

    // 1. バリデーションチェック（100円単位チェックのみ残す）
    if (bidAmount % 100 !== 0) {
        alert('入札額は100円単位である必要があります。');
        return; 
    }

    // 2. トランザクション処理の開始
    const itemRef = ref(db, `chat/${selectedAuctionId}`); 

    runTransaction(itemRef, (currentData) => {
        // currentData: データベース上の現在のアイテムデータ

        if (currentData) {
            // DB上の現在の価格と入札額を比較
            const dbCurrentPrice = currentData.currentPrice;
            const nextMinBid = dbCurrentPrice + 100;

            // 入札額が、DB上の「現在の価格 + 100円」に達しているかチェック
            if (bidAmount < nextMinBid) {
                // 入札が無効なため、トランザクションを中断 (nullを返すと中断される)
                alert(`無効な入札額です。最低入札額: ¥${nextMinBid.toLocaleString()}以上が必要です。`);
                return; // データの変更を行わず、トランザクションを終了
            }

            // 【入札が有効な場合、データを更新
            currentData.currentPrice = bidAmount;
            currentData.bidCount += 1;
            // 最高入札者を記録 
            currentData.highestBidder = bidderName; 
            
            // 変更後のデータを返すと、DBに書き込まれます
            return currentData; 
        } else {
            // データが存在しない場合 (アイテムが削除されたなど)
            return; 
        }
    })
    .then((result) => {
        // トランザクションが成功または中断した場合
        if (result.committed) { // committed: trueなら書き込み成功
            fapBidInput.value = result.snapshot.val().currentPrice + 100; // 次の最低入札額をセット
            alert(`¥${bidAmount.toLocaleString()}で入札しました！`);
        }
        // committed: falseの場合は、上のトランザクション内でアラートが出ているためここでは何もしない
    })
    .catch((error) => {
        console.error("トランザクションエラー:", error);
        alert('入札処理中にエラーが発生しました。');
    });
});


function hideFAP() {
    fapPanel.style.display = 'none';
    selectedAuctionId = null;
    fapCountdownDisplay.classList.remove('timer-urgent');
}

fapCloseButton.addEventListener('click', hideFAP);

// カードのUI（価格と入札数）を個別に更新する関数
function updateCardUI(item) {
    const cardElement = document.querySelector(`.product-card[data-product-id="${item.id}"]`);
    if (cardElement) {
        // toLocaleString() で数字を「12,345」のように見やすくフォーマット
        cardElement.querySelector('.current-price-display').textContent = `¥${item.currentPrice.toLocaleString()}`;
        cardElement.querySelector('.bid-count-display').textContent = `${item.bidCount}`;

        const bidderDisplay = cardElement.querySelector('.highest-bidder-display');
        if (bidderDisplay){
            bidderDisplay.textContent = item.highestBidder || 'なし';
        }
    }
}


// --- [6] サイト起動時の初期化 ---
document.addEventListener('DOMContentLoaded', () => {
    // FAPを初期状態では非表示
    fapPanel.style.display = 'none';
});