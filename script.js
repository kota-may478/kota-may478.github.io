function navigateTo(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
    }
}

function toggleLanguage() {
    // ここではサンプルとしてアラートを表示しますが、
    // 実際には日本語と英語のコンテンツを切り替えるロジックを実装します。
    alert('言語を切り替える機能はまだ実装されていません。');
}
