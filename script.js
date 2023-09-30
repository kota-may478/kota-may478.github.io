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