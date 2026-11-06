import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { ButtonLink } from "./components/ui";
import { useI18n } from "./i18n";
import Account from "./pages/Account";
import Admin from "./pages/Admin";
import { Login, Register } from "./pages/Auth";
import Builder from "./pages/Builder";
import { Checkout, PaymentReturn, SandboxCheckout } from "./pages/Checkout";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import Legal from "./pages/Legal";
import MatchDetail from "./pages/MatchDetail";
import Matches from "./pages/Matches";
import Pricing from "./pages/Pricing";
import Results from "./pages/Results";

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="container-page py-24 text-center">
      <div className="font-display text-6xl font-bold text-gold-500">404</div>
      <p className="mt-3 text-ink-300">{t("notFound.body")}</p>
      <ButtonLink to="/" className="mt-6">{t("notFound.home")}</ButtonLink>
    </div>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="pricing" element={<Pricing />} />
          <Route path="results" element={<Results />} />
          <Route path="legal" element={<Legal />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="app" element={<Dashboard />} />
          <Route path="app/matches" element={<Matches />} />
          <Route path="app/matches/:id" element={<MatchDetail />} />
          <Route path="app/builder" element={<Builder />} />
          <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="checkout/:plan" element={<RequireAuth><Checkout /></RequireAuth>} />
          <Route path="payment/return" element={<RequireAuth><PaymentReturn /></RequireAuth>} />
          <Route path="payment/sandbox" element={<RequireAuth><SandboxCheckout /></RequireAuth>} />
          <Route path="admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
