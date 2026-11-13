import React from "react";

/**
 * Brand splash: the repository logo centred with "HYDRO team" underneath.
 * It is also present as static HTML before React boots, so the app never shows
 * an empty window; this component keeps the same look during first data load.
 */
export function Splash({ fading }: { fading: boolean }): React.ReactElement {
  return (
    <div className={`splash${fading ? " splash-fading" : ""}`} aria-hidden={fading}>
      <div className="splash-inner">
        <img src="./logo.png" alt="" className="splash-logo" />
        <div className="splash-title">Reedance Studio</div>
        <div className="splash-sub">Reedance content studio · استودیوی محتوا</div>
        <div className="splash-team">HYDRO team</div>
      </div>
    </div>
  );
}
