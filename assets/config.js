/* =============================================================
   LeWorldCup 2026 — Configuration
   Edit values here. No build step needed: save and redeploy.
   ============================================================= */
window.CONFIG = {

  /* Pool title shown in the header */
  poolName: "LeWorldCup 2026",
  subtitle: "Knockout bracket pool",

  /* ----- Live data source (ESPN public scoreboard) -----
     These requests go from each visitor's browser straight to ESPN,
     so they do NOT count against your Netlify bandwidth or functions. */
  espnBase: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
  knockoutStart: "20260628",   // YYYYMMDD — first knockout day
  knockoutEnd:   "20260719",   // YYYYMMDD — final day
  refreshSeconds: 60,          // auto-refresh interval while the page is open

  /* ----- Scoring -----
     Points awarded per CORRECT pick, by round.
     Default = ESPN-style escalating (doubling) scheme. Change freely.
     If you have ESPN's exact 2026 values, just replace the numbers. */
  scoring: {
    R32:   10,
    R16:   20,
    QF:    40,
    SF:    80,
    FINAL: 160,   // Champion (M104)
    THIRD: 40     // Third-place match (M103)
  },

  /* ----- Tiebreaker -----
     Total goals in the Final. Closest to the actual total wins ties. */
  tiebreakLabel: "Total goals in the Final",

  /* ----- Manual override (optional safety net) -----
     Leave empty to rely entirely on ESPN. If ESPN is slow or a team
     name doesn't match, you can force a result here. Keys are match
     ids (M73..M104, M103); value is the winning team (exact pool spelling).
     Example:  "M73": "Canada"
     These take precedence over ESPN. */
  manualResults: {
    // "M73": "Canada"
  },

  /* Hardcode the Final's total goals for the tiebreaker if ESPN lacks it. */
  manualFinalGoals: null
};
