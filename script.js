let flag_open = 0; 
let startX = 0; // Initial touch X-coordinate
let currentX = 0; // Current touch X-coordinate
const slideMenu = document.getElementById('slide-menu');
const closeBtn = document.getElementById('slide-menu-close');
const isTouchDevice = 'ontouchstart' in window;

// Event listener for when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Get all sections with the 'fade-in' class
    const sections = document.querySelectorAll('.fade-in');

    // Function to check if a section is visible in the viewport
    function checkVisibility() {
        const triggerBottom = window.innerHeight * 0.8;
        sections.forEach(section => {
            const sectionTop = section.getBoundingClientRect().top;
            if (sectionTop < triggerBottom) {
                section.classList.add('is-visible'); // Add 'is-visible' class if section is visible
            }
        });
    }

    // Event listeners for scrolling
    window.addEventListener('scroll', checkVisibility);
    checkVisibility();

    const menuOverlay = document.getElementById('overlay');

    // Event listener for clicking the header title
    document.getElementById('header-title').addEventListener('click', function() {
        // Scroll to the top of the page
        window.scrollTo({
            top: 0,
            behavior: "smooth" // Smooth scrolling effect
        });
    });

    if (flag_open === 1) {
        // Event listener for clicking outside the menu
        menuOverlay.addEventListener("click", closeSlideMenu);
    }

    if (flag_open === 0) {
        const hamburgerIcon = document.getElementById('hamburger-icon');
        hamburgerIcon.addEventListener('click', toggleMenu);
    }
    
    // if (isTouchDevice) {
    //     hamburgerIcon.addEventListener('touchend', function(event) {
    //         event.preventDefault();
    //         toggleMenu();
    //     });
    // } else {
    // }

});

slideMenu.addEventListener('touchstart', function(event) {
    startX = event.touches[0].clientX;
    currentX = slideMenu.style.right ? parseInt(slideMenu.style.right) : -280;
    currentX_Btn = closeBtn.style.left ? parseInt(closeBtn.style.left) : -90;
}, false);

slideMenu.addEventListener('touchmove', function(event) {
    let touchX = event.touches[0].clientX;
    let diffX = startX - touchX;
    let newRight = currentX + 4*diffX;
    let newLeft = currentX_Btn;

    // Restrict the position of the slide menu
    if (newRight < -280) {
        newRight = -280;
    }
    if (newRight > 0) newRight = 0;
    if (newLeft > 0) newLeft = 0;
    // if (newLeft > 40) newLeft = 40;

    slideMenu.style.right = newRight + 'px';
    closeBtn.style.left = newLeft + 'px';
}, false);

slideMenu.addEventListener('touchend', function(event) {
    // Decide whether to open or close the slide menu based on its position
    if (parseInt(slideMenu.style.right) < -50) { // center: -115
        closeSlideMenu();
    } else {
        openSlideMenu();
    }
}, false);

// Event listener for clicking the close button of the slide menu
document.getElementById('slide-menu-close').addEventListener('click', closeSlideMenu);

// Function to navigate to a specific section on the page
function navigateTo(sectionId, adjustForHeader = false) {
    // Get the target section by its ID
    const section = document.getElementById(sectionId);
    if (section) {
        // Get the height of the header
        const headerHeight = document.querySelector("header").offsetHeight;

        // Calculate the target scroll position
        let scrollToPosition = section.offsetTop-20;
        if (adjustForHeader) {
            scrollToPosition -= headerHeight; // Adjust for header height if needed
        }

        // Scroll to the target position
        window.scrollTo({
            top: scrollToPosition,
            behavior: "smooth" // Smooth scrolling effect
        });
    }
}

// Function to navigate to a section and close the slide menu
function navigateAndClose(sectionId) {
    if (flag_open === 1) {
        navigateTo(sectionId, true); // Navigate to the section immediately
        closeSlideMenu(); // Close the slide menu and start fading out the overlay
    }
}

function toggleMenu() {
    // const menu = document.getElementById('slide-menu');
    if (flag_open === 0) {
        flag_open = 0.5;
        openSlideMenu();
    }
}

// Function to open the slide menu
function openSlideMenu() {
    const slideMenu = document.getElementById('slide-menu');
    const menuLinks = document.querySelectorAll('#slide-menu a');

    document.getElementById('slide-menu').style.right = '0'; // Move the slide menu to the right
    document.getElementById('slide-menu').classList.add('opened'); // Add 'opened' class to the slide menu
    const overlay = document.getElementById('overlay');
    overlay.style.opacity = '1'; // Fade in the overlay
    overlay.style.display = 'block'; // Display the overlay
    // setTimeout(() => {
    //     overlay.style.opacity = '1'; // Fade in the overlay
    // }, 0);

    const closeBtn = document.getElementById('slide-menu-close');
    closeBtn.style.display = 'block'; // Display the close button
    closeBtn.style.left = '-40px';

    // // Wait for the menu open animation to complete, then re-enable the links
    // setTimeout(() => {
    //     flag_open = 1;
    // }, 200); // Assuming the menu open animation duration is 200ms
    waitForMenuToOpen(() => {
        // console.log("メニューが開きました！");
        flag_open = 1;
        // ここにメニューが開いた後に実行したいコードを書く
    });
}

// Function to close the slide menu
function closeSlideMenu(callback) {
    document.getElementById('slide-menu').style.right = '-280px'; // Move the slide menu to the left
    const overlay = document.getElementById('overlay');
    overlay.style.opacity = '0'; // Fade out the overlay

    setTimeout(() => {
        overlay.style.display = 'none'; // Hide the overlay after it's fully faded out
        const closeBtn = document.getElementById('slide-menu-close');
        closeBtn.style.display = 'none'; // Hide the close button

        if (callback) callback(); // Execute the callback if provided
    }, 200); // Wait for the fade out animation to complete
    waitForMenuToClose(() => {
        // console.log("メニューが開きました！");
        flag_open = 0;
        // ここにメニューが開いた後に実行したいコードを書く
    });
}

// slideMenu.addEventListener('transitionend', function(event) {
//     if (slideMenu.style.right === '0px') { // メニューが開いている場合
//         flag_open = 1;
//     }
//     flag_open = 1;
// });

// Function to toggle between Japanese and English pages
function toggleLanguage() {
    const currentURL = window.location.href;
    if (currentURL.includes('index_en.html')) {
        window.location.href = 'index.html'; // Redirect to the Japanese page
    } else {
        window.location.href = 'index_en.html'; // Redirect to the English page
    }
}

function waitForMenuToOpen(callback) {
    const slideMenu = document.getElementById('slide-menu');
    const computedStyle = getComputedStyle(slideMenu);

    if (computedStyle.right === '0px') {
        callback();
    } else {
        requestAnimationFrame(() => {
            waitForMenuToOpen(callback);
        });
    }
}

function waitForMenuToClose(callback) {
    const slideMenu = document.getElementById('slide-menu');
    const computedStyle = getComputedStyle(slideMenu);

    if (computedStyle.right === '-280px') {
        callback();
    } else {
        requestAnimationFrame(() => {
            waitForMenuToClose(callback);
        });
    }
}