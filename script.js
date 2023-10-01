function navigateTo(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
    }
}

function toggleLanguage(currentLang) {
    if (currentLang === 'en') {
        window.location.href = 'index.html';
    } else {
        window.location.href = 'index_en.html';
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
});

document.getElementById('menuButton').addEventListener('click', function() {
    var menuContent = document.getElementById('menuContent');
    if (menuContent.classList.contains('hidden')) {
        menuContent.classList.remove('hidden');
        menuContent.classList.add('open');
    } else {
        menuContent.classList.remove('open');
        menuContent.classList.add('hidden');
    }
});

function toggleMenu() {
    const menuContent = document.getElementById('menuContent');
    if (menuContent.style.right === '0px') {
        menuContent.style.right = '-300px';
    } else {
        menuContent.style.right = '0px';
    }
}
