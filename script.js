// Global flag to indicate if the menu is open (1 for open, 0 for closed, 0.5 for in transition)
let flag_open = 0; 

// Variables to store touch coordinates for slide menu interactions
let startX = 0; 
let currentX = 0; 

// References to DOM elements for the slide menu and close button
const slideMenu = document.getElementById('slide-menu');
const closeBtn = document.getElementById('slide-menu-close');

// Check if the device supports touch interactions
const isTouchDevice = 'ontouchstart' in window;

// Event listener for when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    const sections = document.querySelectorAll('.fade-in'); // Get all sections with the 'fade-in' class
    const menuOverlay = document.getElementById('overlay'); // Reference to the menu overlay

    // Event listeners for scrolling to check section visibility
    window.addEventListener('scroll', checkVisibility);
    checkVisibility();

    // Function to check if a section is visible in the viewport
    function checkVisibility() {
        const triggerBottom = window.innerHeight * 0.8; // Calculate the trigger position for visibility check

        sections.forEach(section => {
            const sectionTop = section.getBoundingClientRect().top; // Get the top position of the section relative to the viewport
            if (sectionTop < triggerBottom) {
                section.classList.add('is-visible'); // Add 'is-visible' class if section is visible
            }
        });
    }

    // Event listener for clicking the header title to scroll to the top
    document.getElementById('header-title').addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    });

    // Add event listener for clicking outside the menu if the menu is open
    if (flag_open === 1) {
        menuOverlay.addEventListener("click", closeSlideMenu);
    }

    // Add event listener for toggling the menu if the menu is closed
    if (flag_open === 0) {
        const hamburgerIcon = document.getElementById('hamburger-icon');
        hamburgerIcon.addEventListener('click', toggleMenu);
    }
});

// Event listeners for touch interactions with the slide menu
slideMenu.addEventListener('touchstart', function(event) {
    startX = event.touches[0].clientX; // Store the initial touch X-coordinate
    currentX = slideMenu.style.right ? parseInt(slideMenu.style.right) : -280; // Store the current right position of the slide menu
    currentX_Btn = closeBtn.style.left ? parseInt(closeBtn.style.left) : -90; // Store the current left position of the close button
}, false);

slideMenu.addEventListener('touchmove', function(event) {
    let touchX = event.touches[0].clientX; // Get the current touch X-coordinate
    let diffX = startX - touchX; // Calculate the difference between the initial and current touch X-coordinates
    let newRight = currentX + 4*diffX; // Calculate the new right position for the slide menu
    let newLeft = currentX_Btn; // Calculate the new left position for the close button

    // Restrict the position of the slide menu
    if (newRight < -280) {
        newRight = -280;
    }
    if (newRight > 0) newRight = 0;
    if (newLeft > 0) newLeft = 0;

    slideMenu.style.right = newRight + 'px'; // Update the right position of the slide menu
    closeBtn.style.left = newLeft + 'px'; // Update the left position of the close button
}, false);

slideMenu.addEventListener('touchend', function(event) {
    // Decide whether to open or close the slide menu based on its position
    if (parseInt(slideMenu.style.right) < -50) {
        closeSlideMenu();
    } else {
        openSlideMenu();
    }
}, false);

// Event listener for clicking the close button of the slide menu
document.getElementById('slide-menu-close').addEventListener('click', closeSlideMenu);

// Function to navigate to a specific section on the page
function navigateTo(sectionId, adjustForHeader = false) {
    const section = document.getElementById(sectionId); // Get the target section by its ID
    const headerHeight = document.querySelector("header").offsetHeight; // Get the height of the header

    if (section) {
        let scrollToPosition = section.offsetTop-20; // Calculate the target scroll position
        if (adjustForHeader) {
            scrollToPosition -= headerHeight; // Adjust for header height if needed
        }

        // Scroll to the target position
        window.scrollTo({
            top: scrollToPosition,
            behavior: "smooth"
        });
    }
}

// Function to navigate to a section and close the slide menu
function navigateAndClose(sectionId) {
    if (flag_open === 1) {
        navigateTo(sectionId, true); // Navigate to the section immediately
        closeSlideMenu(); // Close the slide menu
    }
}

// Function to toggle the slide menu
function toggleMenu() {
    if (flag_open === 0) {
        flag_open = 0.5; // Set flag to indicate that the menu is in transition
        openSlideMenu();
    }
}

// Function to open the slide menu
function openSlideMenu() {
    const slideMenu = document.getElementById('slide-menu');
    const menuLinks = document.querySelectorAll('#slide-menu a');
    const closeBtn = document.getElementById('slide-menu-close');
    const overlay = document.getElementById('overlay');

    slideMenu.style.right = '0'; // Move the slide menu to the right
    slideMenu.classList.add('opened'); // Add 'opened' class to the slide menu
    overlay.style.display = 'block'; // Display the overlay
    setTimeout(() => {
        overlay.style.opacity = '1'; // Gradually fade in the overlay
    }, 0);

    closeBtn.style.display = 'block'; // Display the close button
    closeBtn.style.left = '-40px'; // Set the left position of the close button

    // Wait for the menu to fully open and then set the flag_open to 1
    waitForMenuToOpen(() => {
        flag_open = 1;
    });
}

// Function to close the slide menu
function closeSlideMenu(callback) {
    slideMenu.style.right = '-280px'; // Move the slide menu to the left
    const overlay = document.getElementById('overlay');
    const closeBtn = document.getElementById('slide-menu-close');

    overlay.style.opacity = '0'; // Gradually fade out the overlay
    waitForMenuToClose(() => {
        flag_open = 0; // Set flag to indicate that the menu is closed
        overlay.style.display = 'none'; // Hide the overlay after it's fully faded out
        closeBtn.style.display = 'none'; // Hide the close button
    });
}

// Function to toggle between Japanese and English pages
function toggleLanguage() {
    const currentURL = window.location.href; // Get the current URL

    // Check the current page and redirect to the other language version
    if (currentURL.includes('index_en.html')) {
        window.location.href = 'index.html'; // Redirect to the Japanese page
    } else {
        window.location.href = 'index_en.html'; // Redirect to the English page
    }
}

// Function to wait for the slide menu to fully open
function waitForMenuToOpen(callback) {
    const slideMenu = document.getElementById('slide-menu');
    const computedStyle = getComputedStyle(slideMenu);

    if (computedStyle.right === '0px') {
        callback(); // Execute the callback function when the menu is fully open
    } else {
        requestAnimationFrame(() => {
            waitForMenuToOpen(callback); // Recursively call the function until the menu is fully open
        });
    }
}

// Function to wait for the slide menu to fully close
function waitForMenuToClose(callback) {
    const slideMenu = document.getElementById('slide-menu');
    const computedStyle = getComputedStyle(slideMenu);

    if (computedStyle.right === '-280px') {
        callback(); // Execute the callback function when the menu is fully closed
    } else {
        requestAnimationFrame(() => {
            waitForMenuToClose(callback); // Recursively call the function until the menu is fully closed
        });
    }
}
