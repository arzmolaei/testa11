import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import App from "./App";
import "./styles.css";
import "./dark-theme.css";
import "./enhancements.css";
import { initializeTheme } from "./theme";
initializeTheme();
class Boundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>صفحه به مشکل خورد</h1>
        <p>
          داده‌های ذخیره‌شده در مرورگر باقی مانده‌اند. صفحه را دوباره باز کنید.
        </p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          بارگذاری دوباره
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <Boundary>
    <App />
  </Boundary>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      const announce = () => {
        if (registration.waiting && navigator.serviceWorker.controller)
          window.dispatchEvent(new Event("seo:update-ready"));
      };
      announce();
      registration.addEventListener("updatefound", () => {
        registration.installing?.addEventListener("statechange", announce);
      });
      void registration.update().catch(() => {});
    }).catch(() => {});
  });
