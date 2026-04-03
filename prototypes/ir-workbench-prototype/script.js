const TODAY_KEY = "2026-03-29";
const MOCK_START_KEY = "2026-01-01";
const MOCK_SEED = 20260329;

const stateLabel = {
  reading: "阅读中",
  later: "稍后阅读",
  favorite: "收藏",
  archived: "已归档"
};

const tabLabel = {
  pending: "待推进材料",
  imported: "导入时间线",
  completed: "完成时间线",
  all: "全部材料"
};

const weekday = ["日", "一", "二", "三", "四", "五", "六"];

function toDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = `${dateObj.getMonth() + 1}`.padStart(2, "0");
  const d = `${dateObj.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateKey, days) {
  const date = parseDate(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function daysBetween(from, to) {
  const ms = parseDate(to).setHours(0, 0, 0, 0) - parseDate(from).setHours(0, 0, 0, 0);
  return Math.floor(ms / 86400000);
}

function minDate(a, b) {
  return a <= b ? a : b;
}

function mulberry32(seed) {
  let t = seed;
  return function random() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function pickOne(random, list) {
  return list[randInt(random, 0, list.length - 1)];
}

function pickMany(random, list, count) {
  const copy = [...list];
  const result = [];
  const total = Math.min(count, copy.length);
  for (let i = 0; i < total; i += 1) {
    const idx = randInt(random, 0, copy.length - 1);
    result.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return result;
}

function weightedPick(random, weightedList) {
  const sum = weightedList.reduce((acc, item) => acc + item.weight, 0);
  let cursor = random() * sum;
  for (const item of weightedList) {
    cursor -= item.weight;
    if (cursor <= 0) return item.value;
  }
  return weightedList[weightedList.length - 1].value;
}

function randomDateKey(random, startKey, endKey) {
  const span = Math.max(0, daysBetween(startKey, endKey));
  return addDays(startKey, randInt(random, 0, span));
}

function getNextTouch(material) {
  if (material.state === "archived") return "";
  let interval = 6;
  if (material.priority >= 90) interval = 1;
  else if (material.priority >= 80) interval = 2;
  else if (material.priority >= 70) interval = 3;
  else if (material.priority >= 60) interval = 4;
  if (material.state === "later") interval += 2;
  if (material.state === "favorite") interval = Math.max(1, interval - 1);
  return addDays(material.lastRead, interval);
}

function createManualMaterials() {
  return [
    {
      id: "m001",
      title: "MarginNote_考研英语_2000-2009_2001",
      type: "pdf",
      state: "reading",
      priority: 95,
      progress: 62,
      lastRead: "2026-03-28",
      imported: "2026-02-24",
      completed: "",
      topic: "考研英语真题",
      tags: ["真题", "2001", "精读"],
      path: "weave/incremental-reading/IR/exam-english/m001.pdf",
      sessions: [
        { date: "2026-03-28", duration: 31, words: 920, action: "继续阅读" },
        { date: "2026-03-26", duration: 28, words: 860, action: "提取卡片" },
        { date: "2026-03-22", duration: 24, words: 740, action: "继续阅读" }
      ]
    },
    {
      id: "m002",
      title: "不择手段背单词",
      type: "md",
      state: "favorite",
      priority: 88,
      progress: 77,
      lastRead: "2026-03-27",
      imported: "2026-02-19",
      completed: "",
      topic: "词汇",
      tags: ["词根", "高频", "背诵"],
      path: "weave/incremental-reading/IR/vocabulary/m002.md",
      sessions: [
        { date: "2026-03-27", duration: 22, words: 630, action: "继续阅读" },
        { date: "2026-03-24", duration: 17, words: 540, action: "提取卡片" },
        { date: "2026-03-20", duration: 18, words: 520, action: "继续阅读" }
      ]
    },
    {
      id: "m003",
      title: "写作高分句式替换库",
      type: "epub",
      state: "later",
      priority: 74,
      progress: 19,
      lastRead: "2026-03-18",
      imported: "2026-03-06",
      completed: "",
      topic: "写作",
      tags: ["句式", "替换", "模板"],
      path: "weave/incremental-reading/IR/writing/m003.epub",
      sessions: [
        { date: "2026-03-18", duration: 16, words: 480, action: "继续阅读" },
        { date: "2026-03-11", duration: 14, words: 420, action: "继续阅读" }
      ]
    },
    {
      id: "m004",
      title: "翻译技巧速查手册",
      type: "md",
      state: "archived",
      priority: 30,
      progress: 100,
      lastRead: "2026-03-12",
      imported: "2026-01-30",
      completed: "2026-03-12",
      topic: "翻译",
      tags: ["技巧", "已完成"],
      path: "weave/incremental-reading/IR/translation/m004.md",
      sessions: [
        { date: "2026-03-12", duration: 19, words: 560, action: "完成材料" },
        { date: "2026-03-08", duration: 15, words: 430, action: "提取卡片" }
      ]
    },
    {
      id: "m005",
      title: "长难句拆解专项",
      type: "pdf",
      state: "reading",
      priority: 79,
      progress: 46,
      lastRead: "2026-03-29",
      imported: "2026-03-10",
      completed: "",
      topic: "语法",
      tags: ["长难句", "结构分析"],
      path: "weave/incremental-reading/IR/grammar/m005.pdf",
      sessions: [
        { date: "2026-03-29", duration: 33, words: 960, action: "继续阅读" },
        { date: "2026-03-25", duration: 21, words: 640, action: "提取卡片" },
        { date: "2026-03-19", duration: 18, words: 520, action: "继续阅读" }
      ]
    }
  ];
}

function createGeneratedMaterials(total, startIndex = 6) {
  const random = mulberry32(MOCK_SEED);
  const topics = [
    { name: "考研英语真题", tags: ["真题", "阅读"] },
    { name: "词汇", tags: ["单词", "词根"] },
    { name: "写作", tags: ["模板", "改写"] },
    { name: "语法", tags: ["长难句", "句法"] },
    { name: "翻译", tags: ["语感", "技巧"] },
    { name: "完形", tags: ["逻辑词", "衔接"] },
    { name: "阅读速度", tags: ["训练", "节奏"] },
    { name: "题型策略", tags: ["定位", "排除法"] }
  ];
  const titlePartsA = ["精读计划", "专项拆解", "高频整理", "难点突破", "对照复盘", "策略笔记", "纠错合集", "强化清单"];
  const titlePartsB = ["第I阶段", "阶段二", "冲刺版", "扩展版", "速览版", "核心版", "专题A", "专题B"];
  const globalTags = ["导入", "复盘", "卡片提取", "重点", "薄弱项", "二刷", "三刷", "链接回溯"];
  const materials = [];

  for (let i = 0; i < total; i += 1) {
    const topic = pickOne(random, topics);
    const type = weightedPick(random, [
      { value: "md", weight: 0.4 },
      { value: "pdf", weight: 0.4 },
      { value: "epub", weight: 0.2 }
    ]);
    const state = weightedPick(random, [
      { value: "reading", weight: 0.38 },
      { value: "later", weight: 0.3 },
      { value: "favorite", weight: 0.18 },
      { value: "archived", weight: 0.14 }
    ]);

    const imported = randomDateKey(random, MOCK_START_KEY, "2026-03-24");
    const daysSpan = Math.max(1, daysBetween(imported, TODAY_KEY));
    const sessionCount = state === "archived" ? randInt(random, 3, 9) : randInt(random, 2, 8);
    const dayOffsets = new Set();

    for (let k = 0; k < sessionCount; k += 1) {
      dayOffsets.add(randInt(random, 0, daysSpan));
    }

    const sortedOffsets = [...dayOffsets].sort((a, b) => a - b);
    const sessions = sortedOffsets.map((offset, idx) => {
      const date = minDate(addDays(imported, offset), TODAY_KEY);
      const isLast = idx === sortedOffsets.length - 1;
      let action = "继续阅读";
      if (state === "archived" && isLast) action = "完成材料";
      else if (random() < 0.22) action = "提取卡片";
      else if (random() < 0.12) action = "导入后首读";
      return {
        date,
        duration: randInt(random, 9, 46),
        words: randInt(random, 260, 1180),
        action
      };
    });

    const lastRead = sessions[sessions.length - 1]?.date || imported;
    const completed = state === "archived" ? minDate(addDays(lastRead, randInt(random, 0, 2)), TODAY_KEY) : "";
    const progress = state === "archived"
      ? 100
      : state === "later"
        ? randInt(random, 3, 45)
        : state === "favorite"
          ? randInt(random, 58, 96)
          : randInt(random, 28, 89);
    const priority = state === "archived" ? randInt(random, 18, 55) : randInt(random, 48, 97);
    const tags = [...new Set([...pickMany(random, topic.tags, 2), ...pickMany(random, globalTags, 2)])];
    const serial = String(startIndex + i).padStart(3, "0");
    const ext = type === "md" ? "md" : type === "pdf" ? "pdf" : "epub";
    const id = `m${serial}`;

    materials.push({
      id,
      title: `${topic.name} · ${pickOne(random, titlePartsA)} ${pickOne(random, titlePartsB)}`,
      type,
      state,
      priority,
      progress,
      lastRead,
      imported,
      completed,
      topic: topic.name,
      tags,
      path: `weave/incremental-reading/IR/mock-${serial}.${ext}`,
      sessions
    });
  }

  return materials;
}

const materials = [...createManualMaterials(), ...createGeneratedMaterials(42)];

let currentMonth = new Date(2026, 2, 1);
let activeTab = "pending";
let selectedDate = "";
let selectedMaterialId = "";

const metricsGrid = document.getElementById("metrics-grid");
const queueLanes = document.getElementById("queue-lanes");
const trendBars = document.getElementById("trend-bars");
const feedList = document.getElementById("feed-list");
const calendarGrid = document.getElementById("calendar-grid");
const monthLabel = document.getElementById("month-label");
const selectedDaySummary = document.getElementById("selected-day-summary");
const materialsBody = document.getElementById("materials-body");
const detailContent = document.getElementById("detail-content");
const searchInput = document.getElementById("search-input");
const typeFilter = document.getElementById("type-filter");
const stateFilter = document.getElementById("state-filter");
const topicFilter = document.getElementById("topic-filter");
const listTitle = document.getElementById("list-title");

function buildActivityMap() {
  const map = new Map();
  for (const material of materials) {
    addActivity(map, material.imported, "imported", 1, material.id);
    if (material.completed) addActivity(map, material.completed, "completed", 3, material.id);
    for (const session of material.sessions) {
      const actionType = session.action.includes("提取") ? "extracted" : "reading";
      const score = actionType === "reading" ? 2 : 2;
      addActivity(map, session.date, actionType, score, material.id);
    }
  }
  return map;
}

function addActivity(map, date, type, score, materialId) {
  if (!date) return;
  if (!map.has(date)) {
    map.set(date, { score: 0, count: 0, types: new Set(), materialIds: new Set() });
  }
  const row = map.get(date);
  row.score += score;
  row.count += 1;
  row.types.add(type);
  row.materialIds.add(materialId);
}

function scoreToHeat(score) {
  if (score <= 0) return 0;
  if (score <= 3) return 1;
  if (score <= 6) return 2;
  if (score <= 10) return 3;
  return 4;
}

function isMaterialRelatedToDate(material, dateKey) {
  if (!dateKey) return true;
  if (material.imported === dateKey || material.completed === dateKey || material.lastRead === dateKey) return true;
  return material.sessions.some(session => session.date === dateKey);
}

function dueMaterialSort(a, b) {
  const aNext = getNextTouch(a) || "9999-12-31";
  const bNext = getNextTouch(b) || "9999-12-31";
  if (aNext !== bNext) return aNext.localeCompare(bNext);
  return b.priority - a.priority;
}

function getTabFilteredMaterials() {
  const rows = [...materials];
  if (activeTab === "pending") return rows.filter(item => item.state !== "archived").sort(dueMaterialSort);
  if (activeTab === "imported") return rows.sort((a, b) => b.imported.localeCompare(a.imported));
  if (activeTab === "completed") return rows.filter(item => item.completed).sort((a, b) => b.completed.localeCompare(a.completed));
  return rows.sort((a, b) => b.priority - a.priority);
}

function buildEventFeed() {
  const events = [];
  for (const material of materials) {
    events.push({ date: material.imported, type: "导入", materialId: material.id, title: material.title });
    if (material.completed) {
      events.push({ date: material.completed, type: "完成", materialId: material.id, title: material.title });
    }
    for (const session of material.sessions) {
      events.push({ date: session.date, type: session.action, materialId: material.id, title: material.title });
    }
  }
  events.sort((a, b) => b.date.localeCompare(a.date));
  return events;
}

const activityMap = buildActivityMap();
const eventFeed = buildEventFeed();

function renderMetrics() {
  const nonArchived = materials.filter(item => item.state !== "archived");
  const dueItems = nonArchived.filter(item => getNextTouch(item) <= TODAY_KEY);
  const highBacklog = dueItems.filter(item => item.priority >= 85).length;
  const imported7 = materials.filter(item => daysBetween(item.imported, TODAY_KEY) >= 0 && daysBetween(item.imported, TODAY_KEY) <= 6).length;
  const completed7 = materials.filter(item => item.completed && daysBetween(item.completed, TODAY_KEY) >= 0 && daysBetween(item.completed, TODAY_KEY) <= 6).length;
  const reading = materials.filter(item => item.state === "reading").length;
  const extracted7 = eventFeed.filter(event => event.type.includes("提取") && daysBetween(event.date, TODAY_KEY) >= 0 && daysBetween(event.date, TODAY_KEY) <= 6).length;

  const cards = [
    { label: "今日待推进", value: dueItems.length, sub: "下次触达 ≤ 今天" },
    { label: "高优先级积压", value: highBacklog, sub: "Priority ≥ 85" },
    { label: "近7天导入", value: imported7, sub: "新增材料" },
    { label: "近7天完成", value: completed7, sub: "完成材料" },
    { label: "阅读中", value: reading, sub: "当前活跃" },
    { label: "近7天提取", value: extracted7, sub: "卡片提取事件" }
  ];

  metricsGrid.innerHTML = cards
    .map(card => `
      <article class="metric-card">
        <div class="metric-label">${card.label}</div>
        <div class="metric-value">${card.value}</div>
        <div class="metric-sub">${card.sub}</div>
      </article>
    `)
    .join("");
}

function renderQueueLanes() {
  const nonArchived = materials.filter(item => item.state !== "archived");
  const dueRows = nonArchived.filter(item => getNextTouch(item) <= TODAY_KEY);
  const total = Math.max(1, nonArchived.length);
  const lanes = [
    { key: "high", label: "高优先级待处理", value: dueRows.filter(item => item.priority >= 85).length, className: "high" },
    { key: "mid", label: "中优先级待处理", value: dueRows.filter(item => item.priority >= 60 && item.priority < 85).length, className: "mid" },
    { key: "low", label: "低优先级待处理", value: dueRows.filter(item => item.priority < 60).length, className: "low" },
    { key: "active", label: "阅读中材料", value: materials.filter(item => item.state === "reading" || item.state === "favorite").length, className: "active" }
  ];

  queueLanes.innerHTML = lanes
    .map(lane => {
      const percent = Math.min(100, Math.round((lane.value / total) * 100));
      return `
        <div class="lane-item">
          <div class="lane-head"><span>${lane.label}</span><strong>${lane.value}</strong></div>
          <div class="lane-track"><div class="lane-fill ${lane.className}" style="width:${percent}%"></div></div>
        </div>
      `;
    })
    .join("");
}

function renderTrend() {
  const points = [];
  for (let i = 13; i >= 0; i -= 1) {
    const date = addDays(TODAY_KEY, -i);
    const entry = activityMap.get(date);
    points.push({ date, score: entry ? entry.score : 0 });
  }
  const max = Math.max(1, ...points.map(point => point.score));

  trendBars.innerHTML = points
    .map(point => {
      const height = Math.max(10, Math.round((point.score / max) * 100));
      const active = selectedDate === point.date || (selectedDate === "" && point.date === TODAY_KEY);
      return `<button class="trend-bar ${active ? "active" : ""}" data-date="${point.date}" style="height:${height}%;" title="${point.date} · ${point.score}"></button>`;
    })
    .join("");

  for (const node of trendBars.querySelectorAll(".trend-bar")) {
    node.addEventListener("click", () => {
      selectedDate = node.dataset.date || "";
      currentMonth = new Date(parseDate(selectedDate).getFullYear(), parseDate(selectedDate).getMonth(), 1);
      refreshViews();
    });
  }
}

function renderFeed() {
  const list = selectedDate ? eventFeed.filter(item => item.date === selectedDate) : eventFeed.slice(0, 22);
  feedList.innerHTML = list
    .map(item => `
      <li class="feed-item" data-id="${item.materialId}" data-date="${item.date}">
        <strong>${item.type}</strong>${item.title}<br>${item.date}
      </li>
    `)
    .join("");

  for (const row of feedList.querySelectorAll(".feed-item")) {
    row.addEventListener("click", () => {
      selectedMaterialId = row.dataset.id || "";
      selectedDate = row.dataset.date || "";
      currentMonth = new Date(parseDate(selectedDate).getFullYear(), parseDate(selectedDate).getMonth(), 1);
      refreshViews();
    });
  }
}

function renderCalendar() {
  monthLabel.textContent = `${currentMonth.getFullYear()} 年 ${currentMonth.getMonth() + 1} 月`;
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = 42;

  const cells = [];
  for (let i = 0; i < totalCells; i += 1) {
    const date = new Date(firstDay);
    date.setDate(i - startOffset + 1);
    const key = toDateKey(date);
    const inMonth = date.getMonth() === currentMonth.getMonth();
    const entry = activityMap.get(key) || { score: 0, count: 0, types: new Set() };
    const lv = scoreToHeat(entry.score);
    const active = selectedDate === key;
    const dots = ["imported", "reading", "completed", "extracted"]
      .filter(type => entry.types.has(type))
      .map(type => `<i class="activity-dot dot-${type}"></i>`)
      .join("");

    cells.push(`
      <button class="day-cell heat-lv${lv} ${inMonth ? "" : "muted"} ${active ? "active" : ""}" data-date="${key}">
        <div class="day-head"><span>${date.getDate()}</span><span>${weekday[date.getDay()]}</span></div>
        <div class="day-score">${entry.count ? `${entry.count} 条` : ""}</div>
        <div class="activity-dot-group">${dots}</div>
      </button>
    `);
  }

  calendarGrid.innerHTML = cells.join("");
  for (const node of calendarGrid.querySelectorAll(".day-cell")) {
    node.addEventListener("click", () => {
      const key = node.dataset.date || "";
      selectedDate = selectedDate === key ? "" : key;
      refreshViews();
    });
  }

  if (!selectedDate) {
    selectedDaySummary.textContent = "当前未选日期，显示全局材料与最新活动。";
  } else {
    const entry = activityMap.get(selectedDate);
    const count = entry ? entry.count : 0;
    const related = materials.filter(item => isMaterialRelatedToDate(item, selectedDate)).length;
    selectedDaySummary.textContent = `${selectedDate} · 活动 ${count} 条 · 相关材料 ${related} 个`;
  }
}

function renderMaterials() {
  let rows = getTabFilteredMaterials();
  const query = searchInput.value.trim().toLowerCase();
  const type = typeFilter.value;
  const state = stateFilter.value;
  const topic = topicFilter.value;

  rows = rows.filter(item => isMaterialRelatedToDate(item, selectedDate));
  rows = rows.filter(item => (type === "all" ? true : item.type === type));
  rows = rows.filter(item => (state === "all" ? true : item.state === state));
  rows = rows.filter(item => (topic === "all" ? true : item.topic === topic));
  rows = rows.filter(item => {
    if (!query) return true;
    const corpus = `${item.title} ${item.tags.join(" ")} ${item.topic}`.toLowerCase();
    return corpus.includes(query);
  });

  listTitle.textContent = selectedDate ? `${tabLabel[activeTab]} · ${selectedDate}` : tabLabel[activeTab];

  if (!selectedMaterialId || !rows.some(row => row.id === selectedMaterialId)) {
    selectedMaterialId = rows[0]?.id || "";
  }

  materialsBody.innerHTML = rows
    .map(item => {
      const nextTouch = getNextTouch(item) || "-";
      const activeClass = item.id === selectedMaterialId ? "active" : "";
      const priorityClass = item.priority >= 85 ? "p-high" : item.priority >= 60 ? "p-mid" : "p-low";
      return `
        <tr class="${activeClass}" data-id="${item.id}">
          <td class="material-title">${item.title}</td>
          <td>${item.type.toUpperCase()}</td>
          <td><span class="badge state-${item.state}">${stateLabel[item.state]}</span></td>
          <td><span class="priority ${priorityClass}">${item.priority}</span></td>
          <td>${item.progress}%</td>
          <td>${nextTouch}</td>
          <td>${item.lastRead}</td>
          <td>${item.topic}</td>
        </tr>
      `;
    })
    .join("");

  for (const node of materialsBody.querySelectorAll("tr")) {
    node.addEventListener("click", () => {
      selectedMaterialId = node.dataset.id || "";
      renderMaterials();
      renderDetail();
    });
  }

  renderDetail();
}

function renderDetail() {
  const material = materials.find(item => item.id === selectedMaterialId);
  if (!material) {
    detailContent.innerHTML = "<p style='color:#69758f;'>当前筛选下没有材料</p>";
    return;
  }

  const sessions = [...material.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const extractedCount = material.sessions.filter(item => item.action.includes("提取")).length;
  const nextTouch = getNextTouch(material) || "不再调度";

  detailContent.innerHTML = `
    <div class="detail-head">
      <h3>${material.title}</h3>
      <p>${material.topic} · ${material.type.toUpperCase()} · ${stateLabel[material.state]}</p>
    </div>
    <div class="detail-tags">${material.tags.map(tag => `<span class="tag-chip">${tag}</span>`).join("")}</div>

    <div class="detail-grid">
      <div class="detail-item"><label>优先级</label><strong>${material.priority}</strong></div>
      <div class="detail-item"><label>阅读进度</label><strong>${material.progress}%</strong></div>
      <div class="detail-item"><label>导入时间</label><strong>${material.imported}</strong></div>
      <div class="detail-item"><label>完成时间</label><strong>${material.completed || "未完成"}</strong></div>
      <div class="detail-item"><label>上次阅读</label><strong>${material.lastRead}</strong></div>
      <div class="detail-item"><label>下次触达</label><strong>${nextTouch}</strong></div>
      <div class="detail-item"><label>提取次数</label><strong>${extractedCount}</strong></div>
      <div class="detail-item"><label>路径</label><strong>${material.path}</strong></div>
    </div>

    <div class="detail-actions">
      <button class="btn-primary">继续阅读</button>
      <button class="btn-soft">提高优先级</button>
      <button class="btn-soft">暂停</button>
      <button class="btn-soft">归档</button>
    </div>

    <div class="session-list">
      ${sessions.map(session => `
        <div class="session-item">
          <div><strong>${session.action}</strong><br>${session.date}</div>
          <div>${session.duration} 分钟 · ${session.words} 词</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderTopicFilterOptions() {
  const topics = [...new Set(materials.map(item => item.topic))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  topicFilter.innerHTML = `<option value="all">全部专题</option>${topics.map(topic => `<option value="${topic}">${topic}</option>`).join("")}`;
}

function refreshViews() {
  renderQueueLanes();
  renderTrend();
  renderFeed();
  renderCalendar();
  renderMaterials();
}

function bindEvents() {
  document.getElementById("prev-month").addEventListener("click", () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById("next-month").addEventListener("click", () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    renderCalendar();
  });

  document.getElementById("tabs").addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const tab = target.dataset.tab;
    if (!tab) return;
    activeTab = tab;
    for (const node of document.querySelectorAll(".tab")) {
      node.classList.toggle("active", node === target);
    }
    renderMaterials();
  });

  document.getElementById("continue-btn").addEventListener("click", () => {
    const next = materials
      .filter(item => item.state !== "archived")
      .sort(dueMaterialSort)[0];
    if (!next) return;
    selectedMaterialId = next.id;
    selectedDate = next.lastRead;
    currentMonth = new Date(parseDate(selectedDate).getFullYear(), parseDate(selectedDate).getMonth(), 1);
    refreshViews();
  });

  document.getElementById("clear-date-btn").addEventListener("click", () => {
    selectedDate = "";
    refreshViews();
  });

  searchInput.addEventListener("input", renderMaterials);
  typeFilter.addEventListener("change", renderMaterials);
  stateFilter.addEventListener("change", renderMaterials);
  topicFilter.addEventListener("change", renderMaterials);
}

function bootstrap() {
  renderTopicFilterOptions();
  selectedMaterialId = materials.filter(item => item.state !== "archived").sort((a, b) => b.priority - a.priority)[0]?.id || materials[0]?.id || "";
  renderMetrics();
  bindEvents();
  refreshViews();
}

bootstrap();
