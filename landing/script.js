document.addEventListener('DOMContentLoaded', () => {
    const lines = document.querySelectorAll('.terminal-body .line');

    // Typewriter sequence for terminal demo
    lines.forEach((line) => {
        const delay = parseInt(line.getAttribute('data-delay') || '0');
        setTimeout(() => {
            line.classList.add('visible');
        }, delay);
    });

    // Smooth scroll for nav links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

    // Reveal on scroll
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    const revealElements = document.querySelectorAll(
        '.feature-card, .preview-code-box, .postgres-card, .mcp-card, .command-item, .output-files'
    );

    revealElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
        observer.observe(el);
    });
});
