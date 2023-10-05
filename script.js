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
    navigateTo(sectionId, true); // Navigate to the section immediately
    closeSlideMenu(); // Close the slide menu and start fading out the overlay
}

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

    // Event listener for clicking outside the menu
    menuOverlay.addEventListener("click", closeSlideMenu);
    // menuOverlay.addEventListener("touchend", closeSlideMenu);


    // Event listener for clicking the header title
    document.getElementById('header-title').addEventListener('click', function() {
        // Scroll to the top of the page
        window.scrollTo({
            top: 0,
            behavior: "smooth" // Smooth scrolling effect
        });
    });

    const hamburgerIcon = document.getElementById('hamburger-icon');

    function toggleMenu() {
        const menu = document.getElementById('slide-menu');
        if (menu.style.right === '0px') {
            closeSlideMenu();
        } else {
            openSlideMenu();
        }
    }
    
    if (isTouchDevice) {
        hamburgerIcon.addEventListener('touchend', function(event) {
            event.preventDefault();
            toggleMenu();
        });
    } else {
        // hamburgerIcon.addEventListener('click', toggleMenu);
    }

});

// Function to open the slide menu
function openSlideMenu() {
    const slideMenu = document.getElementById('slide-menu');
    const menuLinks = document.querySelectorAll('#slide-menu a');

    document.getElementById('slide-menu').style.right = '0'; // Move the slide menu to the right
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'block'; // Display the overlay
    setTimeout(() => {
        overlay.style.opacity = '1'; // Fade in the overlay
    }, 0);
    document.getElementById('slide-menu').classList.add('opened'); // Add 'opened' class to the slide menu

    const closeBtn = document.getElementById('slide-menu-close');
    closeBtn.style.display = 'block'; // Display the close button
    closeBtn.style.left = '-40px';

    //  // Disable all links inside the slide menu for both mouse and touch inputs while the menu is transitioning
    //  menuLinks.forEach(link => {
    //      link.style.pointerEvents = 'none';
    //  });

    // // Add a transitionend event listener to the slide menu
    // slideMenu.addEventListener('transitionend', function handleTransitionEnd() {
    //     // Re-enable the links after the transition completes
    //     menuLinks.forEach(link => {
    //         link.style.pointerEvents = 'auto';
    //     });
    //     // Remove the event listener after it's executed once
    //     slideMenu.removeEventListener('transitionend', handleTransitionEnd);
    // });

    // // Disable the hamburger icon for both mouse and touch inputs while the menu is transitioning
    // const hamburgerIcon = document.getElementById('hamburger-icon');
    // hamburgerIcon.style.pointerEvents = 'none';

    // Wait for the menu open animation to complete, then re-enable the links
    // setTimeout(() => {
    //     menuLinks.forEach(link => {
    //         link.style.pointerEvents = 'auto';  // Change 'auto' to 'initial'
    //     });
    //     hamburgerIcon.style.pointerEvents = 'auto';
    // }, 300); // Assuming the menu open animation duration is 300ms
}

// Function to close the slide menu
function closeSlideMenu(callback) {
    document.getElementById('slide-menu').style.right = '-280px'; // Move the slide menu to the left
    const overlay = document.getElementById('overlay');
    overlay.style.opacity = '0'; // Fade out the overlay

    // // Disable the hamburger icon for both mouse and touch inputs while the menu is transitioning
    // const hamburgerIcon = document.getElementById('hamburger-icon');
    // hamburgerIcon.style.pointerEvents = 'none';

    setTimeout(() => {
        overlay.style.display = 'none'; // Hide the overlay after it's fully faded out
        const closeBtn = document.getElementById('slide-menu-close');
        // closeBtn.style.left = '-40px'; // Move the close button further out of view
        closeBtn.style.display = 'none'; // Hide the close button

        // // Re-enable the hamburger icon for both mouse and touch inputs after the menu close animation completes
        // hamburgerIcon.style.pointerEvents = 'auto';

        if (callback) callback(); // Execute the callback if provided
    }, 300); // Wait for the fade out animation to complete
}

// // Event listener for clicking the hamburger icon
// document.getElementById('hamburger-icon').addEventListener('click', function() {
//     const menu = document.getElementById('slide-menu');
//     if (menu.style.right === '0px') {
//         closeSlideMenu(); // Close the slide menu if it's open
//     } else {
//         openSlideMenu(); // Open the slide menu if it's closed
//     }
// });

// document.getElementById('hamburger-icon').addEventListener('touchend', function() {
//     const menu = document.getElementById('slide-menu');
//     if (menu.style.right === '0px') {
//         closeSlideMenu(); // Close the slide menu if it's open
//     } else {
//         openSlideMenu(); // Open the slide menu if it's closed
//     }
// });

// Event listeners for touch interactions with the slide menu
let startX = 0; // Initial touch X-coordinate
let currentX = 0; // Current touch X-coordinate
const slideMenu = document.getElementById('slide-menu');
const closeBtn = document.getElementById('slide-menu-close');

slideMenu.addEventListener('touchstart', function(event) {
    startX = event.touches[0].clientX;
    currentX = slideMenu.style.right ? parseInt(slideMenu.style.right) : -280;
    currentX_Btn = closeBtn.style.left ? parseInt(closeBtn.style.left) : -90;
}, false);

slideMenu.addEventListener('touchmove', function(event) {
    let touchX = event.touches[0].clientX;
    let diffX = startX - touchX;
    let newRight = currentX + 4*diffX;
    let newLeft = currentX_Btn;  // ×ボタンの位置を更新

    // Restrict the position of the slide menu
    if (newRight < -280) {
        newRight = -280;
    }
    // if (newLeft < -90) {
    //     newLeft = -90;
    // }
    if (newRight > 0) newRight = 0;
    if (newLeft > 0) newLeft = 0;
    // if (newLeft > 40) newLeft = 40;

    slideMenu.style.right = newRight + 'px';
    closeBtn.style.left = newLeft + 'px';

    // Make the close button follow the slide menu
    // const closeBtn = document.getElementById('slide-menu-close');
    // closeBtn.style.left = (0 + newRight) + 'px';
}, false);

slideMenu.addEventListener('touchend', function(event) {
    // Decide whether to open or close the slide menu based on its position
    if (parseInt(slideMenu.style.right) < -50) { // center: -115
        closeSlideMenu();
    } else {
        openSlideMenu();
    }
}, false);

// slideMenu.addEventListener('touchend', function(event) {
//     // スワイプ動作が起こった後、指が離れるとメニュータブが閉じる
//     closeSlideMenu();
// }, false);

// Event listener for clicking the close button of the slide menu
document.getElementById('slide-menu-close').addEventListener('click', closeSlideMenu);

// Function to toggle between Japanese and English pages
function toggleLanguage() {
    const currentURL = window.location.href;
    if (currentURL.includes('index_en.html')) {
        window.location.href = 'index.html'; // Redirect to the Japanese page
    } else {
        window.location.href = 'index_en.html'; // Redirect to the English page
    }
}