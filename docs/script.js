document.addEventListener('DOMContentLoaded', () => {
    const lines = document.querySelectorAll('.terminal-body .line');

    // Simple typewriter sequence
    lines.forEach((line, index) => {
        const delay = parseInt(line.getAttribute('data-delay') || '0');
        setTimeout(() => {
            line.classList.add('visible');

            // If it's the last line, maybe do a scroll effect or keep it static
            if (index === lines.length - 1) {
                line.style.borderRight = 'none';
            }
        }, delay);
    });

    // Smooth scroll for nav links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });

    // Reveal on scroll effect
    const observerOptions = {
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    document.querySelectorAll('.feature-card, .preview-text, .preview-code-box').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'all 0.6s ease-out';
        observer.observe(el);
    });
});
