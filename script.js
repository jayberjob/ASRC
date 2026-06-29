const BOARD_ID = "operations";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const config = window.ASRC_CONFIG || {};
const configured = Boolean(
  config.SUPABASE_URL &&
  config.SUPABASE_PUBLISHABLE_KEY &&
  !config.SUPABASE_URL.includes("YOUR_PROJECT_ID") &&
  !config.SUPABASE_PUBLISHABLE_KEY.includes("YOUR_KEY")
);

const db = configured && window.supabase
  ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY)
  : null;

let posts = [];
let comments = [];
let likedPostIds = new Set();
let openedCommentIds = new Set();
let currentFilter = "all";
let passwordAction = null;
let reloadTimer = null;
let realtimePosts = null;
let realtimeComments = null;
let toastTimer = null;

function createUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function getVoterId() {
  const key = "asrc_board_voter_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = createUuid();
    localStorage.setItem(key, id);
  }
  return id;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function showToast(message) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function readableError(error, fallback) {
  const message = error?.message || "";
  if (message.includes("schema cache") && message.includes("comments")) {
    return "Supabase에서 supabase_update_v2.sql을 먼저 실행해주세요.";
  }
  if (message.includes("Could not find the function")) {
    return "Supabase 업데이트 SQL을 먼저 실행해주세요.";
  }
  return message || fallback;
}

function commentsFor(postId) {
  return comments.filter(comment => comment.opinion_id === postId);
}

function sortedPosts() {
  const sort = $("#sortSelect").value;
  const filtered = currentFilter === "all"
    ? [...posts]
    : posts.filter(post => post.category === currentFilter);

  return filtered.sort((a, b) => {
    if (sort === "likes") return Number(b.likes || 0) - Number(a.likes || 0) || new Date(b.created_at) - new Date(a.created_at);
    if (sort === "comments") return commentsFor(b.id).length - commentsFor(a.id).length || new Date(b.created_at) - new Date(a.created_at);
    if (sort === "oldest") return new Date(a.created_at) - new Date(b.created_at);
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function renderComment(comment) {
  return `
    <article class="comment-item">
      <div>
        <div class="comment-head">
          <strong>${escapeHtml(comment.author_name)}</strong>
          <span>${formatDate(comment.created_at)}</span>
        </div>
        <p class="comment-text">${escapeHtml(comment.content)}</p>
      </div>
      <button class="comment-delete" type="button" data-action="delete-comment" data-comment-id="${comment.id}" aria-label="댓글 삭제">삭제</button>
    </article>
  `;
}

function renderPost(post) {
  const postComments = commentsFor(post.id);
  const commentsOpen = openedCommentIds.has(post.id);
  const liked = likedPostIds.has(post.id);

  return `
    <article class="post-card" id="post-${post.id}" data-post-id="${post.id}">
      <div class="post-body">
        <div class="post-top">
          <div>
            <div class="post-meta">
              <span class="category-chip">${escapeHtml(post.category)}</span>
              <span class="post-author">${escapeHtml(post.nickname)}</span>
              <span>${formatDate(post.created_at)}</span>
              ${post.updated_at && post.updated_at !== post.created_at ? "<span>수정됨</span>" : ""}
            </div>
            <h3 class="post-title">${escapeHtml(post.title)}</h3>
          </div>
          <div class="post-menu">
            <button class="icon-btn" type="button" data-action="edit-post" data-post-id="${post.id}" aria-label="글 수정">수정</button>
            <button class="icon-btn" type="button" data-action="delete-post" data-post-id="${post.id}" aria-label="글 삭제">삭제</button>
          </div>
        </div>
        <p class="post-content">${escapeHtml(post.content)}</p>
      </div>

      <div class="post-actions">
        <button class="action-btn ${liked ? "liked" : ""}" type="button" data-action="like" data-post-id="${post.id}">
          <span>${liked ? "♥" : "♡"}</span> 좋아요 <strong>${Number(post.likes || 0)}</strong>
        </button>
        <button class="action-btn" type="button" data-action="toggle-comments" data-post-id="${post.id}" aria-expanded="${commentsOpen}">
          <span>💬</span> 댓글 <strong>${postComments.length}</strong>
        </button>
        <button class="action-btn share" type="button" data-action="share" data-post-id="${post.id}">
          <span>↗</span> 공유
        </button>
      </div>

      <div class="comments-wrap" ${commentsOpen ? "" : "hidden"}>
        <div class="comments-panel">
          <div class="comment-list">
            ${postComments.length ? postComments.map(renderComment).join("") : '<p class="comment-empty">첫 댓글을 남겨보세요.</p>'}
          </div>
          <form class="comment-form" data-post-id="${post.id}">
            <input name="author" maxlength="12" value="${escapeHtml(localStorage.getItem("asrc_author_name") || "")}" placeholder="이름" aria-label="댓글 작성자 이름" required />
            <input name="content" maxlength="300" placeholder="댓글을 입력하세요" aria-label="댓글 내용" required />
            <input name="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="비밀번호 4자리" aria-label="댓글 비밀번호" required />
            <button class="btn primary" type="submit">등록</button>
          </form>
        </div>
      </div>
    </article>
  `;
}

function renderBoard() {
  const list = sortedPosts();
  $("#postList").innerHTML = list.map(renderPost).join("");
  $("#emptyState").hidden = list.length > 0;
  $("#postCount").textContent = posts.length;
  $("#commentCount").textContent = comments.length;
  $("#likeCount").textContent = posts.reduce((sum, post) => sum + Number(post.likes || 0), 0);
  focusSharedPost();
}

async function loadBoard({ silent = false } = {}) {
  if (!db) {
    renderBoard();
    return;
  }

  try {
    const [postsResult, commentsResult, likesResult] = await Promise.all([
      db.from("opinions")
        .select("id, meeting_id, nickname, category, title, content, likes, created_at, updated_at")
        .eq("meeting_id", BOARD_ID)
        .order("created_at", { ascending: false }),
      db.from("comments")
        .select("id, opinion_id, author_name, content, created_at")
        .order("created_at", { ascending: true }),
      db.rpc("get_my_liked_opinions", {
        p_voter_id: getVoterId(),
        p_meeting_id: BOARD_ID
      })
    ]);

    if (postsResult.error) throw postsResult.error;
    if (commentsResult.error) throw commentsResult.error;
    if (likesResult.error) throw likesResult.error;

    posts = postsResult.data || [];
    const postIds = new Set(posts.map(post => post.id));
    comments = (commentsResult.data || []).filter(comment => postIds.has(comment.opinion_id));
    likedPostIds = new Set((likesResult.data || []).map(item => item.opinion_id));
    renderBoard();
  } catch (error) {
    console.error(error);
    if (!silent) showToast(readableError(error, "게시판을 불러오지 못했습니다."));
  }
}

function openPostModal(post = null) {
  $("#postForm").reset();
  $("#editingPostId").value = post?.id || "";
  $("#postModalTitle").textContent = post ? "글 수정" : "새 글 작성";
  $("#postSubmitBtn").textContent = post ? "수정하기" : "등록하기";
  $("#authorName").value = post?.nickname || localStorage.getItem("asrc_author_name") || "";
  $("#category").value = post?.category || "운영";
  $("#postTitle").value = post?.title || "";
  $("#postContent").value = post?.content || "";
  $("#postPassword").value = "";
  updatePostCharCount();
  $("#postModal").classList.add("open");
  $("#postModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#authorName").focus(), 50);
}

function closePostModal() {
  $("#postModal").classList.remove("open");
  $("#postModal").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function openPasswordModal(action) {
  passwordAction = action;
  $("#passwordForm").reset();
  $("#passwordTitle").textContent = action.type === "delete-comment" ? "댓글 삭제" : "글 삭제";
  $("#passwordHelp").textContent = "작성할 때 설정한 4자리 비밀번호를 입력해주세요.";
  $("#passwordModal").classList.add("open");
  $("#passwordModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#passwordCheck").focus(), 50);
}

function closePasswordModal() {
  passwordAction = null;
  $("#passwordModal").classList.remove("open");
  $("#passwordModal").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function updatePostCharCount() {
  $("#postCharCount").textContent = $("#postContent").value.length;
}

async function submitPost(event) {
  event.preventDefault();
  if (!db) return showToast("Supabase 연결 설정을 먼저 완료해주세요.");

  const id = $("#editingPostId").value;
  const author = $("#authorName").value.trim();
  const category = $("#category").value;
  const title = $("#postTitle").value.trim();
  const content = $("#postContent").value.trim();
  const password = $("#postPassword").value.trim();
  const button = $("#postSubmitBtn");

  if (!/^\d{4}$/.test(password)) return showToast("비밀번호는 숫자 4자리로 입력해주세요.");

  button.disabled = true;
  button.textContent = id ? "수정 중..." : "등록 중...";

  try {
    let result;
    if (id) {
      result = await db.rpc("update_opinion", {
        p_id: id,
        p_password: password,
        p_nickname: author,
        p_category: category,
        p_title: title,
        p_content: content
      });
      if (result.error) throw result.error;
      if (!result.data) throw new Error("비밀번호가 맞지 않습니다.");
    } else {
      result = await db.rpc("create_opinion", {
        p_meeting_id: BOARD_ID,
        p_nickname: author,
        p_category: category,
        p_title: title,
        p_content: content,
        p_password: password
      });
      if (result.error) throw result.error;
    }

    localStorage.setItem("asrc_author_name", author);
    closePostModal();
    await loadBoard({ silent: true });
    showToast(id ? "글을 수정했습니다." : "글을 등록했습니다.");
  } catch (error) {
    console.error(error);
    showToast(readableError(error, id ? "글을 수정하지 못했습니다." : "글을 등록하지 못했습니다."));
  } finally {
    button.disabled = false;
    button.textContent = id ? "수정하기" : "등록하기";
  }
}

async function toggleLike(postId, button) {
  if (!db) return showToast("Supabase 연결 설정을 먼저 완료해주세요.");
  button.disabled = true;
  try {
    const { data, error } = await db.rpc("toggle_opinion_like", {
      p_opinion_id: postId,
      p_voter_id: getVoterId()
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const post = posts.find(item => item.id === postId);
    if (post && row) post.likes = Number(row.like_count || 0);
    if (row?.is_liked) likedPostIds.add(postId);
    else likedPostIds.delete(postId);
    renderBoard();
  } catch (error) {
    console.error(error);
    showToast(readableError(error, "좋아요를 반영하지 못했습니다."));
  } finally {
    button.disabled = false;
  }
}

async function submitComment(form) {
  if (!db) return showToast("Supabase 연결 설정을 먼저 완료해주세요.");
  const postId = form.dataset.postId;
  const author = form.elements.author.value.trim();
  const content = form.elements.content.value.trim();
  const password = form.elements.password.value.trim();
  const button = $("button[type='submit']", form);

  if (!/^\d{4}$/.test(password)) return showToast("댓글 비밀번호는 숫자 4자리로 입력해주세요.");

  button.disabled = true;
  button.textContent = "등록 중";
  try {
    const { error } = await db.rpc("create_comment", {
      p_opinion_id: postId,
      p_author_name: author,
      p_content: content,
      p_password: password
    });
    if (error) throw error;
    localStorage.setItem("asrc_author_name", author);
    openedCommentIds.add(postId);
    await loadBoard({ silent: true });
    showToast("댓글을 등록했습니다.");
  } catch (error) {
    console.error(error);
    showToast(readableError(error, "댓글을 등록하지 못했습니다."));
  } finally {
    button.disabled = false;
    button.textContent = "등록";
  }
}

async function confirmPasswordAction(event) {
  event.preventDefault();
  if (!db || !passwordAction) return;
  const password = $("#passwordCheck").value.trim();
  const button = $("#passwordForm button");
  if (!/^\d{4}$/.test(password)) return showToast("비밀번호는 숫자 4자리로 입력해주세요.");

  button.disabled = true;
  button.textContent = "확인 중...";
  try {
    if (passwordAction.type === "delete-post") {
      const { data, error } = await db.rpc("delete_opinion", {
        p_id: passwordAction.id,
        p_password: password
      });
      if (error) throw error;
      if (!data) throw new Error("비밀번호가 맞지 않습니다.");
      showToast("글을 삭제했습니다.");
    } else if (passwordAction.type === "delete-comment") {
      const { data, error } = await db.rpc("delete_comment", {
        p_id: passwordAction.id,
        p_password: password
      });
      if (error) throw error;
      if (!data) throw new Error("비밀번호가 맞지 않습니다.");
      showToast("댓글을 삭제했습니다.");
    }
    closePasswordModal();
    await loadBoard({ silent: true });
  } catch (error) {
    console.error(error);
    showToast(readableError(error, "삭제하지 못했습니다."));
  } finally {
    button.disabled = false;
    button.textContent = "확인";
  }
}

async function sharePost(postId) {
  const post = posts.find(item => item.id === postId);
  const url = new URL(window.location.href);
  url.hash = `post-${postId}`;
  const shareData = {
    title: post?.title ? `ASRC · ${post.title}` : "ASRC 운영 계획",
    text: post?.content?.slice(0, 90) || "ASRC 운영 계획 게시판",
    url: url.toString()
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareData.url);
      showToast("글 링크를 복사했습니다.");
    } else {
      const input = document.createElement("textarea");
      input.value = shareData.url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      showToast("글 링크를 복사했습니다.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast("공유하지 못했습니다.");
  }
}

function focusSharedPost() {
  if (!location.hash.startsWith("#post-")) return;
  const target = document.querySelector(location.hash);
  if (!target) return;
  setTimeout(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("shared-target");
    setTimeout(() => target.classList.remove("shared-target"), 1500);
  }, 120);
}

function handlePostListClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const postId = button.dataset.postId;

  if (action === "edit-post") {
    const post = posts.find(item => item.id === postId);
    if (post) openPostModal(post);
  } else if (action === "delete-post") {
    openPasswordModal({ type: "delete-post", id: postId });
  } else if (action === "like") {
    toggleLike(postId, button);
  } else if (action === "toggle-comments") {
    if (openedCommentIds.has(postId)) openedCommentIds.delete(postId);
    else openedCommentIds.add(postId);
    renderBoard();
  } else if (action === "share") {
    sharePost(postId);
  } else if (action === "delete-comment") {
    openPasswordModal({ type: "delete-comment", id: button.dataset.commentId });
  }
}

function startRealtime() {
  if (!db) return;
  const reload = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadBoard({ silent: true }), 250);
  };

  realtimePosts = db
    .channel("asrc-board-posts")
    .on("postgres_changes", { event: "*", schema: "public", table: "opinions" }, reload)
    .subscribe();

  realtimeComments = db
    .channel("asrc-board-comments")
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, reload)
    .subscribe();
}

$("#setupBanner").hidden = configured;
$("#openPostBtn").addEventListener("click", () => openPostModal());
$("#postForm").addEventListener("submit", submitPost);
$("#postContent").addEventListener("input", updatePostCharCount);
$("#passwordForm").addEventListener("submit", confirmPasswordAction);
$("#postList").addEventListener("click", handlePostListClick);
$("#postList").addEventListener("submit", event => {
  const form = event.target.closest(".comment-form");
  if (!form) return;
  event.preventDefault();
  submitComment(form);
});

$$('[data-close-post]').forEach(element => element.addEventListener("click", closePostModal));
$$('[data-close-password]').forEach(element => element.addEventListener("click", closePasswordModal));

$$('.filter').forEach(button => button.addEventListener("click", () => {
  currentFilter = button.dataset.filter;
  $$('.filter').forEach(item => item.classList.toggle("active", item === button));
  renderBoard();
}));

$("#sortSelect").addEventListener("change", renderBoard);
window.addEventListener("hashchange", focusSharedPost);
window.addEventListener("scroll", () => $("#topBtn").classList.toggle("show", window.scrollY > 500));
$("#topBtn").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closePostModal();
    closePasswordModal();
  }
});

window.addEventListener("beforeunload", () => {
  if (db && realtimePosts) db.removeChannel(realtimePosts);
  if (db && realtimeComments) db.removeChannel(realtimeComments);
});

renderBoard();
loadBoard();
startRealtime();
