const meetings = {
  "2026-first": {
    title: "2026년 상반기 ASRC 정기회의",
    description: "상반기 활동을 돌아보고, 하반기 운영 방향과 신규 러닝 프로그램을 논의합니다.",
    date: "2026. 06. 20. 토요일 19:00",
    place: "안산 중앙동 커뮤니티룸",
    attendance: "ASRC 크루원 누구나",
    status: "의견 수렴 완료",
    agendas: [
      ["01", "상반기 활동 리뷰", "정기런, 번개런, 대회 참가 등 상반기 활동을 함께 돌아봅니다.", "운영"],
      ["02", "하반기 정기런 운영", "요일, 시간, 코스, 페이스그룹 운영 방식을 논의합니다.", "러닝"],
      ["03", "신규 크루원 적응", "처음 참여하는 크루원이 더 편하게 어울릴 방법을 찾습니다.", "친목"],
      ["04", "안전한 러닝 문화", "야간 러닝, 도로 횡단, 비상상황 대응 기준을 정리합니다.", "안전"]
    ]
  },
  "2026-second": {
    title: "2026년 하반기 ASRC 정기회의",
    description: "한 해를 마무리하며 내년도 운영계획, 신규 프로그램, 크루 문화를 함께 설계합니다.",
    date: "2026. 12. 12. 토요일 18:30",
    place: "안산 고잔동 문화공간",
    attendance: "ASRC 크루원 누구나",
    status: "의견 수렴 중",
    agendas: [
      ["01", "2026 활동 결산", "올해 좋았던 점과 아쉬웠던 점을 함께 정리합니다.", "운영"],
      ["02", "2027 운영 계획", "정기런 일정, 운영진 역할, 연간 이벤트를 논의합니다.", "운영"],
      ["03", "대회 및 원정런", "함께 참가할 대회와 다른 지역 원정런 계획을 세웁니다.", "러닝"],
      ["04", "크루 문화와 친목", "ASRC다운 분위기와 즐거운 교류 방식을 이야기합니다.", "친목"]
    ]
  }
};

let currentMeeting = localStorage.getItem("asrc-current-meeting") || "2026-second";
let opinions = [];
let likedIds = [];
let currentFilter = "all";
let pendingAction = null;
let editingPassword = "";
let toastTimer;
let realtimeChannel;
let reloadTimer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const config = window.ASRC_CONFIG || {};
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.SUPABASE_URL || "")
  && config.SUPABASE_PUBLISHABLE_KEY
  && !config.SUPABASE_PUBLISHABLE_KEY.includes("YOUR_");
const db = configured
  ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY)
  : null;

function getVoterId() {
  let id = localStorage.getItem("asrc-voter-id");
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
        });
    localStorage.setItem("asrc-voter-id", id);
  }
  return id;
}

const voterId = getVoterId();

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function requireConnection() {
  if (db) return true;
  showToast("먼저 config.js에 Supabase 연결 정보를 입력해주세요.");
  $("#setupBanner").hidden = false;
  return false;
}

function setMeeting(meetingId) {
  currentMeeting = meetingId;
  localStorage.setItem("asrc-current-meeting", meetingId);
  const info = meetings[meetingId];
  $("#meetingTitle").textContent = info.title;
  $("#meetingDescription").textContent = info.description;
  $("#meetingDate").textContent = info.date;
  $("#meetingPlace").textContent = info.place;
  $("#meetingAttendance").textContent = info.attendance;
  $("#meetingStatus").textContent = info.status;
  $$(".meeting-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.meeting === meetingId));
  renderAgenda();
  loadOpinions();
}

function renderAgenda() {
  const grid = $("#agendaGrid");
  grid.innerHTML = meetings[currentMeeting].agendas.map(item => `
    <article class="agenda-card">
      <span class="agenda-number">AGENDA ${item[0]}</span>
      <h3>${item[1]}</h3>
      <p>${item[2]}</p>
      <button type="button" data-agenda-category="${item[3]}">이 안건에 의견 남기기 →</button>
    </article>
  `).join("");

  $$('[data-agenda-category]').forEach(btn => {
    btn.addEventListener("click", () => {
      if (requireConnection()) openOpinionForm(btn.dataset.agendaCategory);
    });
  });
}

function meetingOpinions() {
  return opinions.filter(item => item.meetingId === currentMeeting);
}

function mapOpinion(row) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    nickname: row.nickname,
    category: row.category,
    title: row.title,
    content: row.content,
    likes: Number(row.likes) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadOpinions({ silent = false } = {}) {
  if (!db) {
    opinions = [];
    likedIds = [];
    renderOpinions();
    return;
  }

  if (!silent) $("#opinionList").classList.add("loading");

  const [opinionsResult, likesResult] = await Promise.all([
    db.from("opinions")
      .select("id, meeting_id, nickname, category, title, content, likes, created_at, updated_at")
      .eq("meeting_id", currentMeeting),
    db.rpc("get_my_liked_opinions", {
      p_voter_id: voterId,
      p_meeting_id: currentMeeting
    })
  ]);

  $("#opinionList").classList.remove("loading");

  if (opinionsResult.error) {
    console.error(opinionsResult.error);
    showToast("의견을 불러오지 못했습니다. Supabase 설정을 확인해주세요.");
    return;
  }

  opinions = (opinionsResult.data || []).map(mapOpinion);
  likedIds = likesResult.error ? [] : (likesResult.data || []).map(item => item.opinion_id);
  renderOpinions();
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function renderOpinions() {
  let items = meetingOpinions();
  if (currentFilter !== "all") items = items.filter(item => item.category === currentFilter);

  const sort = $("#sortSelect").value;
  items.sort((a, b) => {
    if (sort === "likes") return b.likes - a.likes || new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const list = $("#opinionList");
  const empty = $("#emptyState");
  empty.style.display = items.length ? "none" : "block";
  list.innerHTML = items.map(item => {
    const liked = likedIds.includes(item.id);
    return `
      <article class="opinion-card">
        <div class="opinion-top">
          <span class="category-badge">${escapeHtml(item.category)}</span>
          <time>${formatDate(item.createdAt)}</time>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <div class="content">${escapeHtml(item.content)}</div>
        <div class="opinion-bottom">
          <span class="author">by. ${escapeHtml(item.nickname)}</span>
          <div class="card-actions">
            <button class="action-btn" data-edit="${item.id}">수정</button>
            <button class="action-btn" data-delete="${item.id}">삭제</button>
            <button class="like-btn ${liked ? "liked" : ""}" data-like="${item.id}" aria-label="공감">
              <span>${liked ? "♥" : "♡"}</span> ${item.likes}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  $$('[data-like]').forEach(btn => btn.addEventListener("click", () => toggleLike(btn.dataset.like, btn)));
  $$('[data-edit]').forEach(btn => btn.addEventListener("click", () => requestPassword("edit", btn.dataset.edit)));
  $$('[data-delete]').forEach(btn => btn.addEventListener("click", () => requestPassword("delete", btn.dataset.delete)));
  renderSummary();
}

function renderSummary() {
  const items = meetingOpinions();
  const totalLikes = items.reduce((sum, item) => sum + item.likes, 0);
  const counts = items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  const topCategory = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
  const topOpinion = [...items].sort((a, b) => b.likes - a.likes)[0]?.title || "-";

  $("#totalOpinions").textContent = items.length;
  $("#opinionCountHero").textContent = items.length;
  $("#totalLikes").textContent = totalLikes;
  $("#topCategory").textContent = topCategory;
  $("#topOpinion").textContent = topOpinion;
  $("#progressBar").style.width = `${Math.min(items.length / 20 * 100, 100)}%`;
}

async function toggleLike(id, button) {
  if (!requireConnection()) return;
  button.disabled = true;

  const { data, error } = await db.rpc("toggle_opinion_like", {
    p_opinion_id: id,
    p_voter_id: voterId
  });

  button.disabled = false;
  if (error) {
    console.error(error);
    showToast("공감 처리에 실패했습니다.");
    return;
  }

  const result = data?.[0];
  const item = opinions.find(opinion => opinion.id === id);
  if (item && result) item.likes = result.like_count;
  if (result?.is_liked) {
    if (!likedIds.includes(id)) likedIds.push(id);
  } else {
    likedIds = likedIds.filter(likedId => likedId !== id);
  }
  renderOpinions();
}

function openOpinionForm(category = "운영", editItem = null, verifiedPassword = "") {
  $("#opinionForm").reset();
  $("#editingId").value = editItem?.id || "";
  editingPassword = verifiedPassword;
  $("#modalTitle").textContent = editItem ? "의견 수정" : "새 의견 작성";
  $("#opinionForm button[type=submit]").textContent = editItem ? "수정 내용 저장" : "의견 등록하기";
  $("#nickname").value = editItem?.nickname || "";
  $("#category").value = editItem?.category || category;
  $("#opinionTitle").value = editItem?.title || "";
  $("#opinionContent").value = editItem?.content || "";
  $("#password").value = "";
  $("#password").required = !editItem;
  $("#passwordFieldWrap").hidden = Boolean(editItem);
  $("#charCount").textContent = $("#opinionContent").value.length;
  $("#opinionModal").classList.add("open");
  $("#opinionModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#nickname").focus(), 50);
}

function closeOpinionForm() {
  $("#opinionModal").classList.remove("open");
  $("#opinionModal").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editingPassword = "";
}

function requestPassword(action, id) {
  if (!requireConnection()) return;
  pendingAction = { action, id };
  $("#passwordCheck").value = "";
  $("#passwordHelp").textContent = action === "delete"
    ? "삭제하려면 작성할 때 입력한 4자리 비밀번호가 필요합니다."
    : "수정하려면 작성할 때 입력한 4자리 비밀번호가 필요합니다.";
  $("#passwordForm button[type=submit]").textContent = action === "delete" ? "삭제하기" : "확인";
  $("#passwordModal").classList.add("open");
  $("#passwordModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#passwordCheck").focus(), 50);
}

function closePasswordModal() {
  $("#passwordModal").classList.remove("open");
  $("#passwordModal").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  pendingAction = null;
}

$("#opinionForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!requireConnection()) return;

  const editingId = $("#editingId").value;
  const password = $("#password").value.trim();
  if (!editingId && !/^\d{4}$/.test(password)) {
    showToast("비밀번호는 숫자 4자리로 입력해주세요.");
    return;
  }

  const submitButton = $("#opinionForm button[type=submit]");
  submitButton.disabled = true;
  submitButton.textContent = "저장 중...";

  const common = {
    p_nickname: $("#nickname").value.trim(),
    p_category: $("#category").value,
    p_title: $("#opinionTitle").value.trim(),
    p_content: $("#opinionContent").value.trim()
  };

  const result = editingId
    ? await db.rpc("update_opinion", {
        p_id: editingId,
        p_password: editingPassword,
        ...common
      })
    : await db.rpc("create_opinion", {
        p_meeting_id: currentMeeting,
        p_password: password,
        ...common
      });

  submitButton.disabled = false;
  submitButton.textContent = editingId ? "수정 내용 저장" : "의견 등록하기";

  if (result.error) {
    console.error(result.error);
    showToast(result.error.message || "저장에 실패했습니다.");
    return;
  }
  if (editingId && result.data !== true) {
    showToast("비밀번호가 일치하지 않거나 의견이 없습니다.");
    return;
  }

  closeOpinionForm();
  await loadOpinions({ silent: true });
  showToast(editingId ? "의견이 수정되었습니다." : "의견이 등록되었습니다.");
});

$("#passwordForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!pendingAction || !requireConnection()) return;

  const password = $("#passwordCheck").value.trim();
  if (!/^\d{4}$/.test(password)) {
    showToast("숫자 4자리를 입력해주세요.");
    return;
  }

  const { action, id } = pendingAction;
  const submitButton = $("#passwordForm button[type=submit]");
  submitButton.disabled = true;

  if (action === "edit") {
    const { data, error } = await db.rpc("verify_opinion_password", {
      p_id: id,
      p_password: password
    });
    submitButton.disabled = false;

    if (error || data !== true) {
      if (error) console.error(error);
      showToast("비밀번호가 일치하지 않습니다.");
      return;
    }

    const item = opinions.find(opinion => opinion.id === id);
    closePasswordModal();
    if (item) openOpinionForm(item.category, item, password);
    return;
  }

  const { data, error } = await db.rpc("delete_opinion", {
    p_id: id,
    p_password: password
  });
  submitButton.disabled = false;

  if (error || data !== true) {
    if (error) console.error(error);
    showToast("비밀번호가 일치하지 않습니다.");
    return;
  }

  closePasswordModal();
  likedIds = likedIds.filter(likedId => likedId !== id);
  await loadOpinions({ silent: true });
  showToast("의견이 삭제되었습니다.");
});

$("#opinionContent").addEventListener("input", event => {
  $("#charCount").textContent = event.target.value.length;
});

$("#openFormBtn").addEventListener("click", () => {
  if (requireConnection()) openOpinionForm();
});
$$('[data-close-modal]').forEach(el => el.addEventListener("click", closeOpinionForm));
$$('[data-close-password]').forEach(el => el.addEventListener("click", closePasswordModal));

$$(".meeting-tab").forEach(btn => btn.addEventListener("click", () => setMeeting(btn.dataset.meeting)));
$$(".filter").forEach(btn => btn.addEventListener("click", () => {
  currentFilter = btn.dataset.filter;
  $$(".filter").forEach(item => item.classList.toggle("active", item === btn));
  renderOpinions();
}));
$("#sortSelect").addEventListener("change", renderOpinions);

$("#exportBtn").addEventListener("click", () => {
  const data = {
    exportedAt: new Date().toISOString(),
    meeting: meetings[currentMeeting],
    opinions: meetingOpinions()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ASRC_${currentMeeting}_opinions.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("의견 데이터를 내려받았습니다.");
});

const menuBtn = $("#menuBtn");
menuBtn.addEventListener("click", () => {
  const open = $("#mobileNav").classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.textContent = open ? "×" : "☰";
});
$$("#mobileNav a").forEach(link => link.addEventListener("click", () => {
  $("#mobileNav").classList.remove("open");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.textContent = "☰";
}));

window.addEventListener("scroll", () => {
  $("#topBtn").classList.toggle("show", window.scrollY > 520);
});
$("#topBtn").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeOpinionForm();
    closePasswordModal();
  }
});

function startRealtime() {
  if (!db) return;
  realtimeChannel = db
    .channel("asrc-opinions-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "opinions" }, payload => {
      const meetingId = payload.new?.meeting_id || payload.old?.meeting_id;
      if (meetingId && meetingId !== currentMeeting) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => loadOpinions({ silent: true }), 200);
    })
    .subscribe();
}

window.addEventListener("beforeunload", () => {
  if (db && realtimeChannel) db.removeChannel(realtimeChannel);
});

$("#setupBanner").hidden = configured;
setMeeting(currentMeeting);
startRealtime();
