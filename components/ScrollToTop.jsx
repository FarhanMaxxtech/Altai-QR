import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Desktop: .app-main is the scrollable container
    const appMain = document.querySelector('.app-main');
    if (appMain) appMain.scrollTo(0, 0);

    // Mobile: the window/document itself scrolls
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}