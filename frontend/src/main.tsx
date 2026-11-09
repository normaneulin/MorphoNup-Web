import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/atkinson-hyperlegible-next/800.css";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "@fontsource/atkinson-hyperlegible-mono/600.css";
import "./styles/global.css";
import "./styles/pages.css";
import { Footer, Header } from "./components/Brand";
import Home from "./pages/Home";
import Predict from "./pages/Predict";
import Datasets from "./pages/Datasets";
import About from "./pages/About";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/predict" element={<Predict />} />
          <Route path="/datasets" element={<Datasets />} />
          <Route path="/about" element={<About />} />
          <Route
            path="*"
            element={
              <div className="wrap page-head">
                <h1>Page not found</h1>
                <p>
                  Go to <a href="/predict">Predict</a> to try MorphoNup.
                </p>
              </div>
            }
          />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  </StrictMode>,
);
