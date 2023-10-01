function navigateTo(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
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
});

function openSlideMenu() {
    document.getElementById('slide-menu').style.right = '0';
    document.getElementById('overlay').style.display = 'block';
    // openedクラスを追加
    document.getElementById('slide-menu').classList.add('opened');
}

function closeSlideMenu() {
    document.getElementById('slide-menu').style.right = '-300px';
    document.getElementById('overlay').style.display = 'none';
    // openedクラスを削除
    document.getElementById('slide-menu').classList.remove('opened');
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
