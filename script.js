function navigateTo(sectionId, adjustForHeader = false) {
    const section = document.getElementById(sectionId);
    if (section) {
        // ヘッダーの高さを取得
        const headerHeight = document.querySelector("header").offsetHeight;

        // 目的の遷移位置を計算
        let scrollToPosition = section.offsetTop-10;
        if (adjustForHeader) {
            scrollToPosition -= headerHeight;
        }

        // その位置にスクロール
        window.scrollTo({
            top: scrollToPosition,
            behavior: "smooth"
        });
    }
}

function toggleLanguage() {
    const currentURL = window.location.href;
    if (currentURL.includes('index_en.html')) {
        window.location.href = 'index.html'; // 日本語のページにリダイレクト
    } else {
        window.location.href = 'index_en.html'; // 英語のページにリダイレクト
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const sections = document.querySelectorAll('.fade-in');

    function checkVisibility() {
        const triggerBottom = window.innerHeight * 0.8;
        sections.forEach(section => {
            const sectionTop = section.getBoundingClientRect().top;
            if (sectionTop < triggerBottom) {
                section.classList.add('is-visible');
            }
        });
    }

    window.addEventListener('scroll', checkVisibility);
    checkVisibility();

    const menuOverlay = document.getElementById('overlay');

    // メニュー以外の部分をクリックしたときの処理
    menuOverlay.addEventListener("click", closeSlideMenu);

    // ヘッダータイトルをクリックしたときの動作
    document.getElementById('header-title').addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    });
});

function openSlideMenu() {
    document.getElementById('slide-menu').style.right = '0';
    document.getElementById('overlay').style.display = 'block';
    // openedクラスを追加
    document.getElementById('slide-menu').classList.add('opened');
}

function closeSlideMenu(callback) {
    document.getElementById('slide-menu').style.right = '-230px';
    document.getElementById('overlay').style.display = 'none';
    // openedクラスを削除
    document.getElementById('slide-menu').classList.remove('opened');
    setTimeout(callback, 0); // 300msの遅延を追加して、メニュータブが完全に閉じられた後にコールバック関数を実行します
}

// ハンバーガーアイコンをクリックしたときの動作
document.getElementById('hamburger-icon').addEventListener('click', function() {
    const menu = document.getElementById('slide-menu');
    if (menu.style.right === '0px') {
        closeSlideMenu();
    } else {
        openSlideMenu();
    }
});

// メニューを閉じるボタンのクリックイベント
document.getElementById('slide-menu-close').addEventListener('click', closeSlideMenu);

function navigateAndClose(sectionId) {
    closeSlideMenu(() => {
        navigateTo(sectionId, true); // ヘッダーの高さを考慮せずに遷移
    });
}

// script.js

let startX = 0; // タッチ開始時のX座標
let currentX = 0; // タッチ中のX座標
const slideMenu = document.getElementById('slide-menu');

slideMenu.addEventListener('touchstart', function(event) {
    startX = event.touches[0].clientX;
    currentX = slideMenu.style.right ? parseInt(slideMenu.style.right) : -230;
}, false);

slideMenu.addEventListener('touchmove', function(event) {
    let touchX = event.touches[0].clientX;
    let diffX = startX - touchX;
    let newRight = currentX + diffX;

    // メニュータブの位置を制限
    if (newRight < 0) newRight = 0;
    if (newRight > 230) newRight = 230;

    slideMenu.style.right = newRight + 'px';
}, false);

slideMenu.addEventListener('touchend', function(event) {
    // タッチ終了時のメニュータブの位置に応じて、メニュータブを開くか閉じるかを決定
    if (parseInt(slideMenu.style.right) > 115) { // 115はメニュータブの幅の半分
        closeSlideMenu();
    } else {
        openSlideMenu();
    }
}, false);

// script.js の中で

slideMenu.addEventListener('touchmove', function(event) {
    // ... 既存のコード ...

    // ×印がメニュータブに追従するようにleftプロパティを設定
    document.getElementById('slide-menu-close').style.left = (-40 + newRight) + 'px';
}, false);
