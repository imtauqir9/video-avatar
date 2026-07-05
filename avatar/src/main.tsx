import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// No StrictMode: it double-invokes effects in dev, which would create the Daily
// call object twice and throw a "Duplicate DailyIframe" error.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
