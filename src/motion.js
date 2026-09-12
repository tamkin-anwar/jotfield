const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function transitionView(type, update) {
  if (reducedMotion.matches || typeof document.startViewTransition !== 'function') {
    update();
    return Promise.resolve();
  }

  document.documentElement.dataset.transition = type;
  const transition = document.startViewTransition(update);
  transition.finished.finally(() => delete document.documentElement.dataset.transition);
  return transition.finished.catch(() => {});
}
