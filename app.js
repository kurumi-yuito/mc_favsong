/**
 * discomaster_songs.csv: 楽曲名, 作品名, 区分, YYYYMMDD
 */

const CSV_URL = "./discomaster_songs.csv";
const JSON_URL = "./discomaster.json";
const RECOMMEND_URL = "./recommend_tmp.txt";

/** @typedef {{ song: string, work: string, category: string, date: string, dateNum: number, releaseYear: number }} Row */
/** @typedef {{ title: string, songs?: string[] }} DiscEntry */

/** @type {DiscEntry[]} */
let discography = [];

/** @param {string} ymd */
function parseYmd(ymd) {
  const n = parseInt(ymd.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** @param {string} ymd */
function formatYmd(ymd) {
  if (ymd.length !== 8) return ymd;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

/** 年代: -1995（〜1995年）のあと 1996-2000, 2001-2005, … の5年区間 */
const ERA_UPTO_YEAR = 1995;
const ERA_BLOCK_START = 1996;
const ERA_BLOCK_LEN = 5;

/** @type {{ value: string, label: string, minY: number, maxY: number }[]} */
let eraRanges = [];

function buildEraRanges(maxYear) {
  const out = [];
  out.push({
    value: `-${ERA_UPTO_YEAR}`,
    label: `-${ERA_UPTO_YEAR}`,
    minY: -Infinity,
    maxY: ERA_UPTO_YEAR,
  });
  let start = ERA_BLOCK_START;
  while (start <= maxYear) {
    const end = start + ERA_BLOCK_LEN - 1;
    const label = `${start}-${end}`;
    out.push({ value: label, label, minY: start, maxY: end });
    start += ERA_BLOCK_LEN;
  }
  return out;
}

/** @param {number} releaseYear */
function displayEraRangeForRow(releaseYear) {
  if (!Number.isFinite(releaseYear)) return `-${ERA_UPTO_YEAR}`;
  for (const range of eraRanges) {
    if (releaseYear >= range.minY && releaseYear <= range.maxY) return range.label;
  }
  const last = eraRanges[eraRanges.length - 1];
  return last ? last.label : `-${ERA_UPTO_YEAR}`;
}

/** @param {string} line */
function parseLine(line) {
  const parts = line.split(",");
  if (parts.length !== 4) return null;
  const [song, work, category, date] = parts.map((s) => s.trim());
  if (!song) return null;
  const releaseYear = parseInt(date.slice(0, 4), 10);
  return {
    song,
    work,
    category,
    date,
    dateNum: parseYmd(date),
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : NaN,
  };
}

/** @param {string} text */
function normPrefix(text) {
  return text.trim();
}

/** CSV / recommend_tmp の表記ゆれ（アポストロフィ等）を揃えて照合用キーにする */
/** @param {string} s */
function normalizeSongKey(s) {
  return s
    .trim()
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\uff03/g, "#");
}

/**
 * recommend_tmp.txt を *** 区切りでブロック化（各ブロックは空行を除いた行の配列）
 * @param {string} text
 * @returns {string[][]}
 */
function parseRecommendClusters(text) {
  /** @type {string[][]} */
  const blocks = [];
  /** @type {string[]} */
  let cur = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "***") {
      if (cur.length) blocks.push(cur);
      cur = [];
    } else if (t) {
      cur.push(t);
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

function buildRecommendIndex() {
  clusterBySongKey.clear();
  for (const cluster of recommendClusters) {
    for (const title of cluster) {
      clusterBySongKey.set(normalizeSongKey(title), cluster);
    }
  }
}

/** @param {string} title */
function rowForSongTitle(title) {
  const k = normalizeSongKey(title);
  return allRows.find((r) => normalizeSongKey(r.song) === k);
}

/**
 * @param {Row} row
 * @returns {string[] | null}
 */
function clusterForSong(row) {
  return clusterBySongKey.get(normalizeSongKey(row.song)) ?? null;
}

/** @param {string[]} values */
function uniqueSorted(values) {
  return [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, "ja"));
}

/**
 * @param {string[]} values
 * @param {string} query 空なら全件、1文字以上なら先頭一致で絞り込み（大文字小文字は無視）
 */
function suggest(values, query) {
  const q = normPrefix(query);
  const base = uniqueSorted(values);
  if (q.length === 0) return base;
  const qLower = q.toLowerCase();
  return base.filter((v) => v.toLowerCase().startsWith(qLower));
}

/** @type {Row[]} */
let allRows = [];

/** recommend_tmp.txt を *** で区切った各かたまり（曲名のみ・最大10件） */
/** @type {string[][]} */
let recommendClusters = [];

/** 正規化した曲名 → その曲が属するかたまりの曲名配列 */
/** @type {Map<string, string[]>} */
let clusterBySongKey = new Map();

/** @type {{ col: 'song'|'work'|'category'|'date', dir: 'asc'|'desc' }} */
let sortState = { col: "song", dir: "asc" };

const tbody = document.getElementById("song-tbody");
const countEl = document.getElementById("row-count");
const loadError = document.getElementById("load-error");
const detailPanel = document.getElementById("detail-panel");
const clusterTbody = document.getElementById("cluster-tbody");

const filterSong = document.getElementById("filter-song");
const filterWork = document.getElementById("filter-work");
const filterCategory = document.getElementById("filter-category");
const filterEra = document.getElementById("filter-era");

const listSong = document.getElementById("list-song");
const listWork = document.getElementById("list-work");

/** @type {Row | null} */
let selectedRow = null;

function categoryClass(cat) {
  if (cat === "Album") return "cat-album";
  if (cat === "Single") return "cat-single";
  if (cat === "Other") return "cat-other";
  return "cat-other";
}

function songOrWorkActive() {
  return normPrefix(filterSong.value) !== "" || normPrefix(filterWork.value) !== "";
}

function workSpecified() {
  return normPrefix(filterWork.value) !== "";
}

/** 楽曲・作品のいずれかが入っているときは年代をオフ（非活性） */
function syncEraDisabled() {
  const lock = songOrWorkActive();
  if (lock) {
    filterEra.value = "";
  }
  filterEra.disabled = lock;
  filterEra.closest(".filter")?.classList.toggle("filter--era-locked", lock);
}

/** 作品名が入っているときは区分をオフ（非活性） */
function syncCategoryDisabled() {
  const lock = workSpecified();
  if (lock) {
    filterCategory.value = "";
  }
  filterCategory.disabled = lock;
  filterCategory.closest(".filter")?.classList.toggle("filter--category-locked", lock);
}

/**
 * 作品名フィルタに一致する discomaster.json 上のディスクの収録曲名（CSVに行があれば拾う用）
 * @param {string} sWork
 * @returns {Set<string> | null} 該当ディスクがなければ null
 */
function getDiscoverSongSet(sWork) {
  if (!sWork || discography.length === 0) return null;
  const set = new Set();
  let matched = false;
  for (const entry of discography) {
    const t = entry.title;
    if (t === sWork || t.includes(sWork) || sWork.includes(t)) {
      matched = true;
      for (const s of entry.songs || []) {
        if (s) set.add(s);
      }
    }
  }
  return matched ? set : null;
}

/** CSV の作品名列だけの一致 */
function workMatchesCsvColumn(r, sWork) {
  return r.work === sWork || r.work.includes(sWork);
}

function getFiltered() {
  const sSong = normPrefix(filterSong.value);
  const sWork = normPrefix(filterWork.value);
  const sCat = filterCategory.disabled ? "" : filterCategory.value;
  const sEra = filterEra.disabled ? "" : filterEra.value;

  const discoverSet = sWork ? getDiscoverSongSet(sWork) : null;

  return allRows.filter((r) => {
    if (sSong && r.song !== sSong && !r.song.includes(sSong)) return false;

    if (sWork) {
      const viaCsv = workMatchesCsvColumn(r, sWork);
      const viaDiscover = discoverSet && discoverSet.has(r.song);
      if (!viaCsv && !viaDiscover) return false;
    }

    if (sCat && r.category !== sCat) return false;

    if (sEra) {
      if (sEra === `-${ERA_UPTO_YEAR}`) {
        if (!Number.isFinite(r.releaseYear) || r.releaseYear > ERA_UPTO_YEAR) return false;
      } else {
        const m = /^(\d{4})-(\d{4})$/.exec(sEra);
        if (!m || !Number.isFinite(r.releaseYear)) return false;
        const lo = parseInt(m[1], 10);
        const hi = parseInt(m[2], 10);
        if (r.releaseYear < lo || r.releaseYear > hi) return false;
      }
    }
    return true;
  });
}

function sortRows(rows) {
  const { col, dir } = sortState;
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (col === "date") {
      cmp = a.dateNum - b.dateNum;
    } else {
      cmp = String(a[col]).localeCompare(String(b[col]), "ja");
    }
    return cmp * m;
  });
}

function renderTable() {
  syncEraDisabled();
  syncCategoryDisabled();
  const filtered = sortRows(getFiltered());
  if (selectedRow && !filtered.includes(selectedRow)) {
    selectedRow = null;
    detailPanel.hidden = true;
  }
  tbody.replaceChildren();
  for (const r of filtered) {
    const tr = document.createElement("tr");
    tr.className = categoryClass(r.category);
    tr.tabIndex = 0;
    tr.dataset.song = r.song;
    tr.dataset.work = r.work;
    tr.dataset.category = r.category;
    tr.dataset.date = r.date;
    if (selectedRow === r) tr.classList.add("is-selected");

    const tdSong = document.createElement("td");
    tdSong.textContent = r.song;
    const tdWork = document.createElement("td");
    tdWork.textContent = r.work;
    const tdCat = document.createElement("td");
    tdCat.textContent = r.category;
    const tdDate = document.createElement("td");
    tdDate.textContent = formatYmd(r.date);

    tr.append(tdSong, tdWork, tdCat, tdDate);

    tr.addEventListener("click", () => selectRow(r, tr));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectRow(r, tr);
      }
    });

    tbody.appendChild(tr);
  }

  if (selectedRow) {
    renderClusterPanel(selectedRow);
  }

  countEl.textContent = `表示 ${filtered.length} 件 / 全 ${allRows.length} 件`;
}

function renderClusterPanel(row) {
  if (!clusterTbody) return;
  clusterTbody.replaceChildren();

  const cluster = clusterForSong(row);
  if (!cluster) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "cluster-msg";
    td.textContent =
      recommendClusters.length === 0
        ? "recommend_tmp.txt を読み込めていないか、この曲はかたまりに含まれていません。"
        : "この曲は recommend_tmp.txt のかたまりに含まれていません。";
    tr.appendChild(td);
    clusterTbody.appendChild(tr);
    return;
  }

  const selectedKey = normalizeSongKey(row.song);
  for (const title of cluster) {
    const r = rowForSongTitle(title);
    const tr = document.createElement("tr");
    tr.classList.add("row-cluster");
    if (normalizeSongKey(title) === selectedKey) tr.classList.add("is-selected");

    const tdSong = document.createElement("td");
    const tdWork = document.createElement("td");
    const tdCat = document.createElement("td");
    const tdDate = document.createElement("td");

    if (r) {
      tr.classList.add(categoryClass(r.category));
      tdSong.textContent = r.song;
      tdWork.textContent = r.work;
      tdCat.textContent = r.category;
      tdDate.textContent = formatYmd(r.date);
    } else {
      tr.classList.add("cat-other");
      tdSong.textContent = title;
      tdWork.textContent = "—";
      tdCat.textContent = "—";
      tdDate.textContent = "—";
    }
    tr.append(tdSong, tdWork, tdCat, tdDate);
    clusterTbody.appendChild(tr);
  }
}

function selectRow(row, tr) {
  selectedRow = row;
  tbody.querySelectorAll("tr.is-selected").forEach((el) => el.classList.remove("is-selected"));
  tr.classList.add("is-selected");
  detailPanel.hidden = false;
  renderClusterPanel(row);
}

function updateSortButtons() {
  document.querySelectorAll(".sort-btn").forEach((btn) => {
    const col = /** @type {HTMLElement} */ (btn).dataset.sort;
    if (col === sortState.col) {
      btn.setAttribute("data-dir", sortState.dir);
    } else {
      btn.removeAttribute("data-dir");
    }
  });
}

function wireSort() {
  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const col = /** @type {'song'|'work'|'category'|'date'} */ (
        /** @type {HTMLElement} */ (btn).dataset.sort
      );
      if (sortState.col === col) {
        sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      } else {
        sortState.col = col;
        sortState.dir = col === "date" ? "desc" : "asc";
      }
      updateSortButtons();
      renderTable();
    });
  });
}

/**
 * @param {HTMLInputElement} input
 * @param {HTMLUListElement} list
 * @param {string[]} pool
 */
function wireCombo(input, list, pool) {
  let active = -1;

  function close() {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    active = -1;
  }

  function open(items) {
    list.replaceChildren();
    items.forEach((text, i) => {
      const li = document.createElement("li");
      li.role = "option";
      li.textContent = text;
      li.dataset.value = text;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = text;
        close();
        renderTable();
      });
      list.appendChild(li);
    });
    list.hidden = items.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
  }

  input.addEventListener("input", () => {
    const q = input.value;
    open(suggest(pool, q));
    renderTable();
  });

  input.addEventListener("focus", () => {
    open(suggest(pool, input.value));
  });

  input.addEventListener("blur", () => {
    setTimeout(close, 150);
  });

  input.addEventListener("keydown", (e) => {
    const opts = [...list.querySelectorAll("li")];
    if (!list.hidden && opts.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(active + 1, opts.length - 1);
        opts.forEach((el, i) => el.setAttribute("aria-selected", String(i === active)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(active - 1, 0);
        opts.forEach((el, i) => el.setAttribute("aria-selected", String(i === active)));
        return;
      }
      if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        input.value = opts[active].dataset.value || opts[active].textContent || "";
        close();
        renderTable();
        return;
      }
    }
    if (e.key === "Escape") close();
  });
}

const CATEGORY_ORDER = ["Single", "Album", "Other"];

function fillSelects() {
  const present = new Set(allRows.map((r) => r.category));
  const ordered = [
    ...CATEGORY_ORDER.filter((c) => present.has(c)),
    ...[...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort((a, b) => a.localeCompare(b, "ja")),
  ];
  for (const c of ordered) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    filterCategory.appendChild(opt);
  }

  const years = allRows
    .map((r) => r.releaseYear)
    .filter(Number.isFinite);
  const maxYear = years.length
    ? Math.max(...years, new Date().getFullYear())
    : new Date().getFullYear();
  eraRanges = buildEraRanges(maxYear);
  filterEra.replaceChildren();
  const eraAll = document.createElement("option");
  eraAll.value = "";
  eraAll.textContent = "（すべて）";
  filterEra.appendChild(eraAll);
  for (const range of eraRanges) {
    const opt = document.createElement("option");
    opt.value = range.value;
    opt.textContent = range.label;
    filterEra.appendChild(opt);
  }
}

async function load() {
  let text;
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    loadError.hidden = false;
    loadError.textContent =
      "CSV を読み込めませんでした。このフォルダで HTTP サーバーを起動してください（例: PowerShell で .\\serve.ps1 を実行し、ブラウザで http://localhost:8080/ を開く。Python がある場合は python -m http.server 8080 でも可）。file:// では fetch がブロックされます。";
    console.error(e);
    return;
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  allRows = [];
  for (const line of lines) {
    const row = parseLine(line);
    if (row) allRows.push(row);
  }

  try {
    const jres = await fetch(JSON_URL);
    if (jres.ok) {
      discography = await jres.json();
    } else {
      discography = [];
    }
  } catch (e) {
    console.warn("discomaster.json を読めませんでした（作品名は CSV のみで絞り込み）", e);
    discography = [];
  }

  try {
    const rres = await fetch(RECOMMEND_URL);
    if (rres.ok) {
      recommendClusters = parseRecommendClusters(await rres.text());
      buildRecommendIndex();
    }
  } catch (e) {
    console.warn("recommend_tmp.txt を読めませんでした（かたまり表示は使えません）", e);
  }

  const songs = [...new Set(allRows.map((r) => r.song))];
  const works = [...new Set(allRows.map((r) => r.work))];

  fillSelects();
  wireSort();
  updateSortButtons();

  wireCombo(filterSong, listSong, songs);
  wireCombo(filterWork, listWork, works);

  filterWork.value = "DISCOVERY";

  filterCategory.addEventListener("change", renderTable);
  filterEra.addEventListener("change", renderTable);

  renderTable();
}

load();
