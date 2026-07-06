/* =============================================================
   LeWorldCup 2026 — dashboard logic
   Pulls live results from ESPN (client-side), resolves the bracket,
   auto-scores every entrant, and renders the leaderboard + games.
   ============================================================= */
(function () {
  "use strict";
  var B = window.BRACKET, ENTRANTS = window.ENTRANTS,
      FLAGS = window.FLAGS, ALIASES = window.TEAM_ALIASES, C = window.CONFIG;

  var lastSlotWinner = {}, lastStandings = [], selectedEntrant = 0;
  var lastData = [], lastUpdatedTs = 0;
  var meName = lsGet("lwc_me");

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function timeAgo(ts) {
    if (!ts) return "";
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    return Math.round(m / 60) + "h ago";
  }

  function applyTheme(t) {
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }

  /* rank movement since the last time a result changed (persisted) */
  function computeMovement(rows, decided) {
    var snap = lsGet("lwc_snap"), deltas = {};
    rows.forEach(function (r) {
      var prev = snap && snap.ranks ? snap.ranks[r.name] : null;
      deltas[r.name] = (prev == null) ? 0 : (prev - r.rank);
    });
    if (!snap || snap.decided !== decided) {
      var ranks = {};
      rows.forEach(function (r) { ranks[r.name] = r.rank; });
      lsSet("lwc_snap", { decided: decided, ranks: ranks });
    }
    return deltas;
  }

  /* for each undecided matchup with known teams: who gains and does the lead flip */
  function computeSwing(slotTeams, slotWinner, rows) {
    var cur = {};
    rows.forEach(function (r) { cur[r.name] = r.points; });
    var list = [];
    B.order.forEach(function (mid) {
      if (slotWinner[mid]) return;
      var t = slotTeams[mid];
      if (!t || !t[0] || !t[1]) return;
      var rp = C.scoring[B.rounds[mid]] || 0;
      function outcome(team) {
        var gain = ENTRANTS.filter(function (e) { return e.picks[mid] === team; })
                           .map(function (e) { return e.name; });
        var best = null, bestp = -1;
        ENTRANTS.forEach(function (e) {
          var p = (cur[e.name] || 0) + (e.picks[mid] === team ? rp : 0);
          if (p > bestp) { bestp = p; best = e.name; }
        });
        return { team: team, gain: gain, leader: best };
      }
      var oa = outcome(t[0]), ob = outcome(t[1]), flips = oa.leader !== ob.leader;
      list.push({ mid: mid, round: B.roundLabels[B.rounds[mid]], oa: oa, ob: ob,
                  flips: flips, rp: rp, score: rp + (flips ? 10000 : 0) });
    });
    list.sort(function (x, y) { return y.score - x.score; });
    return list;
  }

  /* Monte Carlo: probability each entrant finishes 1st.
     Locked results are fixed; every undecided match is a 50/50 coin flip. */
  function computeWinProb(lockedWinner, finalGoals) {
    var N = 15000, order = B.order, rounds = B.rounds, scoring = C.scoring,
        r32 = B.r32, feeders = B.feeders, wins = {}, i, m;
    ENTRANTS.forEach(function (e) { wins[e.name] = 0; });
    var sw = {}, steams = {};
    for (var s = 0; s < N; s++) {
      for (i = 0; i < order.length; i++) {
        m = order[i];
        var teams;
        if (m === "M103") {
          var t1 = steams.M101, w1 = sw.M101, l1 = (t1 && w1) ? (w1 === t1[0] ? t1[1] : t1[0]) : null;
          var t2 = steams.M102, w2 = sw.M102, l2 = (t2 && w2) ? (w2 === t2[0] ? t2[1] : t2[0]) : null;
          teams = [l1, l2];
        } else if (r32[m]) { teams = r32[m]; }
        else { var f = feeders[m]; teams = [sw[f[0]], sw[f[1]]]; }
        steams[m] = teams;
        if (lockedWinner[m]) sw[m] = lockedWinner[m];
        else if (teams[0] && teams[1]) sw[m] = (Math.random() < 0.5 ? teams[0] : teams[1]);
        else sw[m] = teams[0] || teams[1] || null;
      }
      var best = -1, tied = null;
      for (var k = 0; k < ENTRANTS.length; k++) {
        var e = ENTRANTS[k], pk = e.picks, p = 0;
        for (i = 0; i < order.length; i++) { m = order[i]; if (pk[m] === sw[m]) p += scoring[rounds[m]] || 0; }
        if (p > best) { best = p; tied = [e]; }
        else if (p === best) { tied.push(e); }
      }
      if (tied.length === 1) { wins[tied[0].name] += 1; }
      else if (finalGoals != null) {
        var bd = Infinity, tt = [], q;
        for (q = 0; q < tied.length; q++) {
          var d = Math.abs((tied[q].tiebreak || 0) - finalGoals);
          if (d < bd) { bd = d; tt = [tied[q]]; } else if (d === bd) tt.push(tied[q]);
        }
        for (q = 0; q < tt.length; q++) wins[tt[q].name] += 1 / tt.length;
      } else {
        for (var z = 0; z < tied.length; z++) wins[tied[z].name] += 1 / tied.length;
      }
    }
    var prob = {};
    ENTRANTS.forEach(function (e) { prob[e.name] = wins[e.name] / N; });
    return prob;
  }

  function fmtPct(p) {
    if (p >= 0.995) return "100%";
    if (p <= 0) return "—";
    var v = p * 100;
    return v < 1 ? "<1%" : Math.round(v) + "%";
  }

  /* bracket column orders, laid out so each round lines up with its feeders */
  var COLS = [
    ["Round of 32", ["M74","M77","M73","M75","M83","M84","M81","M82","M76","M78","M79","M80","M86","M88","M85","M87"]],
    ["Round of 16", ["M89","M90","M93","M94","M91","M92","M95","M96"]],
    ["Quarterfinal", ["M97","M98","M99","M100"]],
    ["Semifinal", ["M101","M102"]],
    ["Final", ["M104"]]
  ];

  /* ---------- team-name helpers ---------- */
  function norm(s) {
    return (s || "")
      .toString().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  var CANON = {};
  Object.keys(FLAGS).forEach(function (t) { CANON[norm(t)] = t; });
  function resolveTeam(name) {
    var n = norm(name);
    if (ALIASES[n]) return ALIASES[n];
    if (CANON[n]) return CANON[n];
    return name;
  }
  function flag(team) { return FLAGS[team] || "🏳️"; }
  function isRealCompetitor(c) {
    if (!c || !c.team) return false;
    if (c.team.isActive === false) return false;
    var nm = c.team.displayName || "";
    if (/place|winner|loser|runner|group|\bvs\b/i.test(nm)) return false;
    return true;
  }
  function pairKey(a, b) { return [norm(a), norm(b)].sort().join("|"); }

  /* ---------- ESPN fetch ---------- */
  function fetchScoreboard() {
    var url = C.espnBase + "?dates=" + C.knockoutStart + "-" + C.knockoutEnd;
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("ESPN " + r.status); return r.json(); })
      .then(function (j) { return (j && j.events) || []; });
  }

  var SLUG_LABEL = {
    "round-of-32": "Round of 32", "round-of-16": "Round of 16",
    "quarterfinals": "Quarterfinal", "semifinals": "Semifinal",
    "3rd-place-match": "Third place", "final": "Final", "group-stage": "Group"
  };

  /* ---------- parse events into results + display list ---------- */
  function parseEvents(events) {
    var pairResults = {};     // pairKey -> result
    var eliminated = {};      // normalized team -> true
    var games = [];           // for display
    events.forEach(function (ev) {
      var comp = ev.competitions && ev.competitions[0];
      if (!comp) return;
      var cs = comp.competitors || [];
      if (cs.length !== 2) return;
      var st = (comp.status && comp.status.type) || {};
      var c0 = cs[0], c1 = cs[1];
      var real = isRealCompetitor(c0) && isRealCompetitor(c1);
      var tA = real ? resolveTeam(c0.team.displayName) : c0.team.displayName;
      var tB = real ? resolveTeam(c1.team.displayName) : c1.team.displayName;
      var sA = parseInt(c0.score, 10); if (isNaN(sA)) sA = null;
      var sB = parseInt(c1.score, 10); if (isNaN(sB)) sB = null;
      var g = {
        id: ev.id, state: st.state || "pre", completed: !!st.completed,
        detail: st.shortDetail || "", clock: comp.status && comp.status.displayClock || "",
        date: ev.date, real: real,
        round: SLUG_LABEL[ev.season && ev.season.slug] || (ev.season && ev.season.slug) || "",
        a: tA, b: tB, sa: sA, sb: sB,
        winner: c0.winner ? tA : (c1.winner ? tB : null)
      };
      games.push(g);
      if (real && st.completed && g.winner) {
        var loser = g.winner === tA ? tB : tA;
        pairResults[pairKey(tA, tB)] = {
          winner: g.winner, loser: loser, total: (sA || 0) + (sB || 0)
        };
        eliminated[norm(loser)] = true;
      }
    });
    return { pairResults: pairResults, eliminated: eliminated, games: games };
  }

  /* ---------- resolve the actual bracket from results ---------- */
  function resolveBracket(pairResults) {
    var slotTeams = {}, slotWinner = {}, matchResult = {};
    function setResult(mid, teams) {
      slotTeams[mid] = teams;
      // manual override wins
      if (C.manualResults && C.manualResults[mid]) {
        slotWinner[mid] = C.manualResults[mid]; return;
      }
      if (!teams[0] || !teams[1]) return;
      var r = pairResults[pairKey(teams[0], teams[1])];
      if (r) { slotWinner[mid] = r.winner; matchResult[mid] = r; }
    }
    B.order.forEach(function (mid) {
      if (mid === "M103") {                 // third place = SF losers
        var l1 = loserOf("M101"), l2 = loserOf("M102");
        setResult(mid, [l1, l2]);
      } else if (B.r32[mid]) {
        setResult(mid, B.r32[mid].slice());
      } else {
        var f = B.feeders[mid];
        setResult(mid, [slotWinner[f[0]], slotWinner[f[1]]]);
      }
    });
    function loserOf(mid) {
      var t = slotTeams[mid], w = slotWinner[mid];
      if (!t || !w) return null;
      return w === t[0] ? t[1] : t[0];
    }
    return { slotTeams: slotTeams, slotWinner: slotWinner, matchResult: matchResult };
  }

  /* ---------- score every entrant ---------- */
  function computeStandings(res, eliminated) {
    var sw = res.slotWinner, finalGoals = null;
    if (C.manualFinalGoals != null) finalGoals = C.manualFinalGoals;
    else if (res.matchResult.M104) finalGoals = res.matchResult.M104.total;

    var rows = ENTRANTS.map(function (e) {
      var pts = 0, correct = 0, max = 0;
      B.order.forEach(function (mid) {
        var rp = C.scoring[B.rounds[mid]] || 0;
        var pick = e.picks[mid];
        if (sw[mid]) {                       // decided
          if (pick === sw[mid]) { pts += rp; correct += 1; }
        } else if (pick && !eliminated[norm(pick)]) {
          max += rp;                          // undecided & still alive
        }
      });
      var tbDiff = (finalGoals != null && e.tiebreak != null)
        ? Math.abs(Number(e.tiebreak) - finalGoals) : null;
      return {
        name: e.name, champion: e.picks.M104, tiebreak: e.tiebreak,
        points: pts, correct: correct, maxPossible: pts + max, tbDiff: tbDiff
      };
    });

    var finalDecided = !!sw.M104 || C.manualFinalGoals != null;
    rows.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      if (finalDecided && a.tbDiff != null && b.tbDiff != null && a.tbDiff !== b.tbDiff)
        return a.tbDiff - b.tbDiff;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.name.localeCompare(b.name);
    });
    var rank = 0, prev = null;
    rows.forEach(function (r, i) {
      if (prev === null || r.points !== prev) { rank = i + 1; prev = r.points; }
      r.rank = rank;
    });
    return { rows: rows, finalGoals: finalGoals };
  }

  /* ---------- rendering ---------- */
  function el(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  function render(data) {
    lastData = data;
    var parsed = parseEvents(data),
        res = resolveBracket(parsed.pairResults),
        standings = computeStandings(res, parsed.eliminated);
    lastSlotWinner = res.slotWinner;
    lastStandings = standings.rows;
    lastUpdatedTs = Date.now();
    var rows = standings.rows;

    var decided = Object.keys(res.slotWinner).length;
    var liveCount = parsed.games.filter(function (g) { return g.state === "in"; }).length;
    var deltas = computeMovement(rows, decided);

    // header live pill
    el("livePill").innerHTML = liveCount > 0
      ? '<span class="dot"></span>' + liveCount + " live"
      : '<i class="ti ti-clock"></i> No live games';
    el("livePill").className = "pill " + (liveCount > 0 ? "pill-live" : "pill-idle");

    // metrics
    var champCount = {};
    ENTRANTS.forEach(function (e) { champCount[e.picks.M104] = (champCount[e.picks.M104] || 0) + 1; });
    var topChamp = Object.keys(champCount).sort(function (a, b) { return champCount[b] - champCount[a]; })[0];
    var leader = rows[0];
    var meRow = meName ? rows.filter(function (r) { return r.name === meName; })[0] : null;
    var fourth = meRow
      ? metric("Your position", "#" + meRow.rank + ' <span class="sub">of ' + rows.length + "</span>", "ti-user-star")
      : metric("Matches left", (32 - decided) + ' <span class="sub">/ 32</span>', "ti-clock");
    el("metrics").innerHTML =
      metric("Matches scored", decided + ' <span class="sub">/ 32</span>', "ti-checkbox") +
      metric("Current leader", leader ? (flag(leader.champion) + " " + esc(leader.name)) : "—", "ti-crown") +
      metric("Top champion", flag(topChamp) + " " + esc(topChamp) + ' <span class="sub">x' + champCount[topChamp] + "</span>", "ti-trophy") +
      fourth;

    renderStatus();
    renderPodium(rows);

    // leaderboard
    var winProb = computeWinProb(res.slotWinner, standings.finalGoals);
    var leadPts = leader ? leader.points : 0;
    el("leaderboard").innerHTML = rows.map(function (r) {
      var mv = deltas[r.name] || 0;
      var arrow = mv > 0 ? '<span class="rmv up"><i class="ti ti-chevron-up"></i>' + mv + "</span>"
                : mv < 0 ? '<span class="rmv dn"><i class="ti ti-chevron-down"></i>' + (-mv) + "</span>"
                : '<span class="rmv fl">–</span>';
      var rankCell = (r.rank <= 3 ? '<span class="medal m' + r.rank + '">' + r.rank + "</span>"
                                  : '<span class="rnk">' + r.rank + "</span>") + arrow;
      var behind = r.rank === 1 ? '<span class="lead-tag">Leader</span>' : "-" + (leadPts - r.points);
      var barW = leadPts > 0 ? Math.round(r.points / leadPts * 100) : 0;
      var isMe = r.name === meName;
      return '<tr class="' + (r.rank === 1 ? "leader " : "") + (isMe ? "me" : "") + '">' +
        "<td>" + rankCell + "</td>" +
        '<td class="player">' + esc(r.name) + (isMe ? ' <span class="you">YOU</span>' : "") + "</td>" +
        "<td>" + flag(r.champion) + " " + esc(r.champion) + "</td>" +
        '<td class="num hidem">' + r.correct + "</td>" +
        '<td class="num muted hidem">' + behind + "</td>" +
        '<td class="num potential hidem">' + r.maxPossible + "</td>" +
        '<td class="num winp">' + fmtPct(winProb[r.name]) + "</td>" +
        '<td class="num pts">' + r.points + '<span class="pbar"><span style="width:' + barW + '%"></span></span></td></tr>';
    }).join("");

    renderPaths(rows, res.slotWinner, parsed.eliminated);
    renderSwing(res.slotTeams, res.slotWinner, rows);

    // games: live -> upcoming -> recent finals
    var order = { "in": 0, "pre": 1, "post": 2 };
    var sorted = parsed.games.slice().sort(function (a, b) {
      if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
      return new Date(a.date) - new Date(b.date);
    });
    var pairToMid = {};
    Object.keys(res.slotTeams).forEach(function (mid) {
      var t = res.slotTeams[mid];
      if (t && t[0] && t[1]) pairToMid[pairKey(t[0], t[1])] = mid;
    });
    var shown = sorted.filter(function (g) { return g.state !== "post" || g.real; }).slice(0, 12);
    if (shown.length === 0) {
      el("games").innerHTML = '<div class="empty"><i class="ti ti-ball-football"></i>' +
        "<p>Knockout matches haven’t kicked off yet.</p>" +
        "<span>The board updates automatically as ESPN posts results.</span></div>";
    } else {
      el("games").innerHTML = shown.map(function (g) { return gameCard(g, pairToMid); }).join("");
    }

    renderBrackets();
  }

  /* ---------- per-participant bracket view ---------- */
  function renderBrackets() {
    var tabs = ENTRANTS.map(function (e, i) {
      return '<button class="tab' + (i === selectedEntrant ? " active" : "") +
        '" data-i="' + i + '">' + esc(e.name) + "</button>";
    }).join("");
    var tabBox = el("bracketTabs");
    tabBox.innerHTML = tabs;
    Array.prototype.forEach.call(tabBox.querySelectorAll(".tab"), function (btn) {
      btn.addEventListener("click", function () {
        selectedEntrant = parseInt(btn.getAttribute("data-i"), 10);
        renderBrackets();
      });
    });
    renderBracketView(selectedEntrant);
  }

  function predLoser(e, mid) {            // the feeder team they did NOT advance
    var f = B.feeders[mid], a = e.picks[f[0]], b = e.picks[f[1]];
    return e.picks[mid] === a ? b : a;
  }
  function slotTeamsFor(e, mid) {
    if (mid === "M103") return [predLoser(e, "M101"), predLoser(e, "M102")];
    if (B.r32[mid]) return B.r32[mid];
    var f = B.feeders[mid];
    return [e.picks[f[0]], e.picks[f[1]]];
  }

  function bracketCard(e, mid) {
    var teams = slotTeamsFor(e, mid), pick = e.picks[mid], actual = lastSlotWinner[mid];
    var cardCls = actual ? (pick === actual ? "correct" : "wrong") : "pending";
    var rows = teams.map(function (t) {
      var cls = [];
      if (t === pick) cls.push("sel");
      if (actual) { if (t === actual) cls.push("ok"); else if (t === pick) cls.push("bad"); }
      return '<div class="bt ' + cls.join(" ") + '">' + flag(t) + " " + esc(t || "—") + "</div>";
    }).join("");
    return '<div class="bm ' + cardCls + '" title="' + esc(mid) + '">' + rows + "</div>";
  }

  function renderBracketView(idx) {
    var e = ENTRANTS[idx];
    var row = lastStandings.filter(function (r) { return r.name === e.name; })[0] || {};
    var sum = '<div class="bsum"><span class="nm">' + esc(e.name) + "</span>" +
      '<span class="chip"><i class="ti ti-trophy"></i> ' + flag(e.picks.M104) + " " + esc(e.picks.M104) + "</span>" +
      '<span class="chip">' + (row.points != null ? row.points + " pts" : "0 pts") + "</span>" +
      '<span class="chip">' + (row.correct != null ? row.correct : 0) + " correct</span>" +
      '<span class="chip">TB ' + esc(e.tiebreak) + "</span></div>";

    var cols = COLS.map(function (c) {
      var cards = c[1].map(function (mid) { return bracketCard(e, mid); }).join("");
      return '<div class="bcolwrap"><div class="bcolh">' + c[0] + '</div><div class="bcol">' + cards + "</div></div>";
    }).join("");

    var third = '<div class="third"><span class="lbl"><i class="ti ti-medal-2"></i> Third place</span>' +
      bracketCard(e, "M103") + "</div>";

    var legend = '<div class="legend">' +
      '<span><span class="sw sw-sel"></span> their pick</span>' +
      '<span><span class="sw sw-ok"></span> correct</span>' +
      '<span><span class="sw sw-bad"></span> eliminated</span>' +
      "<span>updates live as results come in</span></div>";

    el("bracketView").innerHTML = sum + '<div class="bracket">' + cols + "</div>" + third + legend;
  }

  function metric(label, value, icon) {
    return '<div class="metric"><div class="ml"><i class="ti ' + icon + '"></i>' + esc(label) +
      '</div><div class="mv">' + value + "</div></div>";
  }

  function gameCard(g, pairToMid) {
    var badge, cls;
    if (g.state === "in") { badge = '<span class="dot"></span>' + esc(g.clock || "Live"); cls = "g-live"; }
    else if (g.state === "post") { badge = '<i class="ti ti-check"></i> FT'; cls = "g-final"; }
    else {
      var d = new Date(g.date);
      badge = '<i class="ti ti-clock"></i> ' + d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      cls = "g-pre";
    }
    function side(team, score, isWin) {
      var sc = score == null ? "" : score;
      return '<div class="gs ' + (isWin ? "win" : "") + '"><span>' + flag(team) + " " + esc(team) +
        '</span><b>' + esc(sc) + "</b></div>";
    }
    var split = "";
    var mid = pairToMid[pairKey(g.a, g.b)];
    if (mid && g.real) {
      var ca = 0, cb = 0;
      ENTRANTS.forEach(function (e) {
        if (e.picks[mid] === g.a) ca++; else if (e.picks[mid] === g.b) cb++;
      });
      if (ca + cb > 0) split = '<div class="split">' + ca + " picked " + esc(g.a) +
        " · " + cb + " picked " + esc(g.b) + "</div>";
    }
    return '<div class="game ' + cls + '"><div class="ghead"><span class="gbadge">' + badge +
      '</span><span class="ground">' + esc(g.round) + "</span></div>" +
      side(g.a, g.sa, g.winner === g.a) + side(g.b, g.sb, g.winner === g.b) + split + "</div>";
  }

  function renderStatus() {
    var up = el("updated");
    if (up) up.textContent = "Updated " + timeAgo(lastUpdatedTs);
    var sel = el("follow");
    if (sel && sel.options && sel.options.length === 0) {
      sel.innerHTML = '<option value="">Follow your bracket…</option>' +
        ENTRANTS.map(function (e) { return '<option value="' + esc(e.name) + '">' + esc(e.name) + "</option>"; }).join("");
    }
    if (sel) sel.value = meName || "";
  }

  function renderPodium(rows) {
    var pod = el("podium");
    if (!pod) return;
    pod.innerHTML = rows.slice(0, 3).map(function (r, i) {
      return '<div class="pod p' + (i + 1) + (r.name === meName ? " me" : "") + '">' +
        '<div class="pmedal">' + (i + 1) + "</div>" +
        '<div class="pname">' + esc(r.name) + "</div>" +
        '<div class="pchamp">' + flag(r.champion) + " " + esc(r.champion) + "</div>" +
        '<div class="ppts">' + r.points + "<span>pts</span></div></div>";
    }).join("");
  }

  function renderSwing(slotTeams, slotWinner, rows) {
    var box = el("swing");
    if (!box) return;
    var list = computeSwing(slotTeams, slotWinner, rows).slice(0, 5);
    if (list.length === 0) {
      box.innerHTML = '<div class="empty"><i class="ti ti-arrows-shuffle"></i>' +
        "<p>No matchups to project yet.</p><span>Swing analysis appears once knockout pairings lock in.</span></div>";
      return;
    }
    box.innerHTML = list.map(function (s) {
      function line(o) {
        var names = o.gain.length ? esc(o.gain.join(", ")) : "no one — everyone busts";
        return '<div class="swo"><span class="swt">' + flag(o.team) + " " + esc(o.team) +
          '</span><span class="swg">+' + s.rp + " · " + names + "</span></div>";
      }
      return '<div class="swing-card' + (s.flips ? " flip" : "") + '"><div class="swh">' +
        '<span class="ground">' + esc(s.round) + "</span>" +
        (s.flips ? '<span class="flipbadge"><i class="ti ti-bolt"></i> could flip the lead</span>' : "") +
        "</div>" + line(s.oa) + line(s.ob) + "</div>";
    }).join("");
  }

  /* ---------- best path to win (per bracket) ---------- */
  function renderPaths(rows, slotWinner, eliminated) {
    var box = el("paths");
    if (!box) return;
    var byName = {};
    ENTRANTS.forEach(function (e) { byName[e.name] = e; });
    box.innerHTML = rows.map(function (r) {
      var e = byName[r.name];
      var champ = e.picks.M104;
      var fin = [e.picks.M101, e.picks.M102];
      var other = fin[0] === champ ? fin[1] : fin[0];
      var champOut = !!eliminated[norm(champ)];
      var otherOut = !!eliminated[norm(other)];
      var champWon = slotWinner.M104 === champ;

      function tspan(t, out) {
        return '<span class="pteam' + (out ? " out" : "") + '">' + flag(t) + " " + esc(t) + "</span>";
      }
      var need;
      if (champWon) {
        need = "🏆 " + tspan(champ) + " won it all — bracket maxed out.";
      } else if (champOut) {
        need = "Title hopes gone — " + tspan(champ, true) + " is out.";
      } else {
        need = "Needs " + tspan(champ, false) + " to win it all" +
          (other ? " and " + tspan(other, otherOut) + " to reach the final" : "") + ".";
      }

      var ff = ["M97", "M98", "M99", "M100"].map(function (m) {
        var t = e.picks[m];
        return '<span class="fft' + (eliminated[norm(t)] ? " out" : "") + '">' + flag(t) + " " + esc(t) + "</span>";
      }).join("");

      var cls = champOut ? "dead" : (r.name === meName ? "me" : "");
      return '<div class="path-card ' + cls + '">' +
        '<div class="ph"><span class="pn">' + esc(r.name) +
        (r.name === meName ? ' <span class="you">YOU</span>' : "") + "</span>" +
        '<span class="pc">' + flag(champ) + " " + esc(champ) + "</span></div>" +
        '<div class="pneed">' + need + "</div>" +
        '<div class="pff"><span class="ffl">Final four:</span> ' + ff + "</div></div>";
    }).join("");
  }

  /* ---------- boot ---------- */
  function load() {
    el("livePill").innerHTML = '<i class="ti ti-loader"></i> Loading';
    fetchScoreboard().then(render).catch(function (err) {
      el("games").innerHTML = '<div class="empty"><i class="ti ti-wifi-off"></i>' +
        "<p>Couldn’t reach ESPN right now.</p><span>" + esc(err.message) +
        " — retrying automatically.</span></div>";
      // still render leaderboard from picks (no results yet)
      render([]);
    });
  }
  function setThemeIcon(t) {
    var b = el("themeBtn");
    if (b) b.innerHTML = '<i class="ti ' + (t === "dark" ? "ti-sun" : "ti-moon") + '"></i>';
  }

  if (typeof document !== "undefined" && document.getElementById && !window.__NO_BOOT__) {
    el("year").textContent = new Date().getFullYear();
    el("poolName2").textContent = C.poolName;
    el("poolName").textContent = C.poolName;
    el("poolSub").textContent = C.subtitle + " · " + ENTRANTS.length + " entries";

    var theme = lsGet("lwc_theme") ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    applyTheme(theme); setThemeIcon(theme);

    var tb = el("themeBtn");
    if (tb) tb.addEventListener("click", function () {
      theme = (theme === "dark") ? "light" : "dark";
      applyTheme(theme); setThemeIcon(theme); lsSet("lwc_theme", theme);
    });
    var rb = el("refreshBtn");
    if (rb) rb.addEventListener("click", function () {
      rb.classList.add("spin"); load();
      setTimeout(function () { rb.classList.remove("spin"); }, 800);
    });
    var fl = el("follow");
    if (fl) fl.addEventListener("change", function () {
      meName = fl.value || null; lsSet("lwc_me", meName); render(lastData);
    });

    load();
    setInterval(load, (C.refreshSeconds || 60) * 1000);
    setInterval(function () {
      var up = el("updated");
      if (up && lastUpdatedTs) up.textContent = "Updated " + timeAgo(lastUpdatedTs);
    }, 10000);
  }

  window.__TEST__ = {
    render: render,
    score: function (events) {
      var p = parseEvents(events), r = resolveBracket(p.pairResults);
      return {
        standings: computeStandings(r, p.eliminated),
        decided: Object.keys(r.slotWinner).length,
        slotWinner: r.slotWinner
      };
    }
  };
})();
