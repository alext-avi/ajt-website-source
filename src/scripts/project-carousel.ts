/** Enhance consecutive Markdown screenshot images without allowing scripts in content. */
export function enhanceProjectCarousels(root: ParentNode = document) {
  const selector =
    "p:has(> a > img:is([title='iPhone 8-style frame'], [title='iOS phone frame'], [title='Android phone frame'], [title='App screenshot'], [title='iPhone XS Max frame']))";
  for (const first of root.querySelectorAll<HTMLElement>(
    `.prose ${selector}`,
  )) {
    if (first.closest('.project-carousel')) continue;
    const slides = [first];
    let next = first.nextElementSibling;
    while (next instanceof HTMLElement && next.matches(selector)) {
      slides.push(next);
      next = next.nextElementSibling;
    }
    if (slides.length < 2) continue;

    const gallery = document.createElement('section');
    gallery.className = 'project-carousel';
    gallery.setAttribute('role', 'region');
    gallery.setAttribute('aria-roledescription', 'carousel');
    gallery.setAttribute('aria-label', 'App screenshots');
    const track = document.createElement('div');
    track.className = 'project-carousel-track';
    track.tabIndex = 0;
    track.setAttribute('role', 'group');
    track.setAttribute('aria-label', 'Screens; use Left and Right arrow keys');
    const controls = document.createElement('div');
    controls.className = 'project-carousel-controls';
    const button = (label: string, text: string) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.setAttribute('aria-label', label);
      element.textContent = text;
      return element;
    };
    const previous = button('Previous screen', '←');
    const forward = button('Next screen', '→');
    const dots = document.createElement('div');
    dots.className = 'project-carousel-dots';
    dots.setAttribute('role', 'group');
    dots.setAttribute('aria-label', 'Choose a screen');
    const status = document.createElement('span');
    status.className = 'project-carousel-status';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    first.before(gallery);
    gallery.append(track, controls);
    track.append(...slides);
    controls.append(previous, dots, forward, status);
    let current = 0;
    const go = (index: number) => {
      const target = Math.max(0, Math.min(index, slides.length - 1));
      track.scrollTo({
        left: slides[target].offsetLeft,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    };
    const indicators = slides.map((slide, index) => {
      slide.setAttribute('role', 'group');
      slide.setAttribute('aria-roledescription', 'slide');
      slide.setAttribute('aria-label', `${index + 1} of ${slides.length}`);
      const dot = button(`Show screen ${index + 1}`, '');
      dot.addEventListener('click', () => go(index));
      dots.append(dot);
      return dot;
    });
    const update = () => {
      current = slides.reduce(
        (closest, slide, index) =>
          Math.abs(slide.offsetLeft - track.scrollLeft) <
          Math.abs(slides[closest].offsetLeft - track.scrollLeft)
            ? index
            : closest,
        0,
      );
      previous.setAttribute('aria-disabled', String(current === 0));
      forward.setAttribute(
        'aria-disabled',
        String(current === slides.length - 1),
      );
      status.textContent = `${current + 1} / ${slides.length}`;
      indicators.forEach((dot, index) => {
        dot.setAttribute('aria-current', String(index === current));
        if (
          index !== current &&
          slides[index].contains(document.activeElement)
        ) {
          track.focus({ preventScroll: true });
        }
        slides[index].inert = index !== current;
        slides[index].setAttribute('aria-hidden', String(index !== current));
      });
    };
    previous.addEventListener('click', () => go(current - 1));
    forward.addEventListener('click', () => go(current + 1));
    track.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      const index = {
        ArrowLeft: current - 1,
        ArrowRight: current + 1,
        Home: 0,
        End: slides.length - 1,
      }[event.key];
      if (index === undefined) return;
      event.preventDefault();
      go(index);
    });
    track.addEventListener('scroll', update, { passive: true });
    update();
  }
}
