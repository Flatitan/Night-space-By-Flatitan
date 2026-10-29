import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// 1. Создай проект на https://supabase.com и вставь сюда Project URL и anon/public key.
// Эти два значения предназначены для браузера. НИКОГДА не вставляй сюда service_role key.
const SUPABASE_URL = 'https://pqcfmkqndcoexodvmffn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_U9QsyEHgwqpM1YcWCnwTdQ_XEoqiXqL';

const configured = SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('ВСТАВЬ') &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_ANON_KEY.includes('ВСТАВЬ');

const $ = (id) => document.getElementById(id);
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const authView = $('auth-view');
const appView = $('app-view');
const authMessage = $('auth-message');
const profileMessage = $('profile-message');
let currentUser = null;
let currentProfile = null;
let selectedPerson = null;
let people = [];
let messageChannel = null;
let authChannel = null;
let loadMessagesToken = 0;

function showNotice(el, message, kind = '') {
  el.textContent = message;
  el.className = `notice ${kind}`.trim();
  el.classList.remove('hidden');
}
function hideNotice(el) { el.classList.add('hidden'); }
function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  button.dataset.originalText ||= button.textContent;
  button.textContent = busy ? 'Подожди…' : button.dataset.originalText;
}
function initials(name = '?') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}
function friendlyError(error) {
  const message = error?.message || 'Что-то пошло не так. Попробуй ещё раз.';
  if (/Invalid login credentials/i.test(message)) return 'Неверный email или пароль.';
  if (/User already registered/i.test(message)) return 'Аккаунт с таким email уже существует.';
  if (/Email not confirmed/i.test(message)) return 'Сначала подтверди email по ссылке в письме.';
  if (/Password should be at least/i.test(message)) return 'Пароль слишком короткий.';
  return message;
}
function showAuthTab(tab) {
  const signup = tab === 'signup';
  $('login-form').classList.toggle('hidden', signup);
  $('signup-form').classList.toggle('hidden', !signup);
  $('tab-login').classList.toggle('active', !signup);
  $('tab-signup').classList.toggle('active', signup);
  hideNotice(authMessage);
}
$('tab-login').addEventListener('click', () => showAuthTab('login'));
$('tab-signup').addEventListener('click', () => showAuthTab('signup'));
$('go-signup').addEventListener('click', () => showAuthTab('signup'));

function showAuth() {
  authView.classList.remove('hidden');
  appView.classList.add('hidden');
  if (messageChannel && supabase) supabase.removeChannel(messageChannel);
  messageChannel = null;
  currentUser = null;
  currentProfile = null;
  selectedPerson = null;
}
async function showApp(user) {
  currentUser = user;
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  await loadMyProfile();
  await loadPeople();
  showPanel('chat-panel');
  subscribeToAuthChanges();
}
function showPanel(panelId) {
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== panelId));
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.panel === panelId));
}
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => showPanel(btn.dataset.panel)));

async function loadMyProfile() {
  if (!currentUser) return;
  const { data, error } = await supabase.from('profiles')
    .select('id, display_name, email, created_at')
    .eq('id', currentUser.id).maybeSingle();
  if (error) console.error('Не удалось загрузить профиль:', error.message);
  currentProfile = data || {
    id: currentUser.id,
    display_name: currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'Пользователь',
    email: currentUser.email
  };
  const name = currentProfile.display_name || 'Пользователь';
  $('side-name').textContent = name;
  $('side-email').textContent = currentUser.email || '';
  $('side-avatar').textContent = initials(name);
  $('profile-avatar').textContent = initials(name);
  $('profile-name').value = name;
  $('profile-email').value = currentUser.email || '';
  const confirmed = Boolean(currentUser.email_confirmed_at);
  $('email-state').textContent = confirmed ? '✓ Email подтверждён' : 'Письмо подтверждения ещё не подтверждено.';
  $('email-state').style.color = confirmed ? '#91d9bb' : '#f1c27d';
}
async function loadPeople() {
  const list = $('people-list');
  list.innerHTML = '<div class="empty-state">Загружаем пользователей…</div>';
  const { data, error } = await supabase.from('profiles')
    .select('id, display_name, email')
    .neq('id', currentUser.id)
    .order('display_name', { ascending: true });
  if (error) {
    list.innerHTML = '<div class="empty-state">Не удалось загрузить пользователей. Проверь SQL-настройку из README.</div>';
    console.error(error);
    return;
  }
  people = data || [];
  renderPeople();
}
function renderPeople() {
  const list = $('people-list');
  const query = $('people-search').value.trim().toLowerCase();
  const filtered = people.filter(person =>
    (person.display_name || '').toLowerCase().includes(query) ||
    (person.email || '').toLowerCase().includes(query)
  );
  $('people-count').textContent = String(people.length);
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = people.length ? 'Никого не нашли по этому запросу.' : 'Пока здесь нет других пользователей. Когда кто-то зарегистрируется, он появится здесь.';
    list.append(empty);
    return;
  }
  filtered.forEach(person => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `person ${selectedPerson?.id === person.id ? 'selected' : ''}`;
    const avatar = document.createElement('span');
    avatar.className = 'mini-avatar';
    avatar.textContent = initials(person.display_name);
    const info = document.createElement('span');
    info.className = 'person-info';
    const name = document.createElement('b');
    name.textContent = person.display_name || 'Пользователь';
    const email = document.createElement('small');
    email.textContent = person.email || '';
    info.append(name, email);
    button.append(avatar, info);
    button.addEventListener('click', () => openChat(person));
    list.append(button);
  });
}
$('people-search').addEventListener('input', renderPeople);

async function openChat(person) {
  selectedPerson = person;
  $('chat-empty').classList.add('hidden');
  $('chat-active').classList.remove('hidden');
  $('chat-name').textContent = person.display_name || 'Пользователь';
  $('chat-avatar').textContent = initials(person.display_name);
  renderPeople();
  await loadMessages();
  subscribeToMessages();
}
async function loadMessages() {
  if (!selectedPerson) return;
  const token = ++loadMessagesToken;
  const { data, error } = await supabase.from('messages')
    .select('id, sender_id, receiver_id, body, created_at')
    .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedPerson.id}),and(sender_id.eq.${selectedPerson.id},receiver_id.eq.${currentUser.id})`)
    .order('created_at', { ascending: true })
    .limit(200);
  if (token !== loadMessagesToken) return;
  if (error) {
    console.error(error);
    $('messages-list').textContent = 'Не удалось загрузить сообщения. Проверь SQL и политики доступа из README.';
    return;
  }
  const container = $('messages-list');
  container.replaceChildren();
  (data || []).forEach(addMessageBubble);
  container.scrollTop = container.scrollHeight;
}
function addMessageBubble(message) {
  const container = $('messages-list');
  // Realtime может прислать сообщение, которое уже попало в результат загрузки.
  if (container.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) return;
  const wrap = document.createElement('div');
  wrap.className = `message ${message.sender_id === currentUser.id ? 'mine' : ''}`;
  wrap.dataset.messageId = message.id;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = message.body;
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Date(message.created_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
  wrap.append(bubble, time);
  container.append(wrap);
  container.scrollTop = container.scrollHeight;
}
function subscribeToMessages() {
  if (messageChannel && supabase) supabase.removeChannel(messageChannel);
  if (!selectedPerson) return;
  const chatPartnerId = selectedPerson.id;
  messageChannel = supabase.channel(`chat-${currentUser.id}-${chatPartnerId}-${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      const message = payload.new;
      const belongsToChat = (message.sender_id === currentUser.id && message.receiver_id === chatPartnerId) ||
        (message.sender_id === chatPartnerId && message.receiver_id === currentUser.id);
      if (belongsToChat) addMessageBubble(message);
    }).subscribe();
}
$('message-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('message-input');
  const body = input.value.trim();
  if (!body || !selectedPerson) return;
  const button = $('message-form').querySelector('button');
  button.disabled = true;
  const { data, error } = await supabase.from('messages').insert({
    sender_id: currentUser.id,
    receiver_id: selectedPerson.id,
    body
  }).select('id, sender_id, receiver_id, body, created_at').single();
  button.disabled = false;
  if (error) {
    alert(`Не удалось отправить сообщение: ${friendlyError(error)}\nПроверь SQL-настройку из README.`);
    return;
  }
  input.value = '';
  if (data) addMessageBubble(data);
  input.focus();
});

$('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  hideNotice(profileMessage);
  const displayName = $('profile-name').value.trim();
  if (displayName.length < 2) {
    showNotice(profileMessage, 'Имя должно содержать минимум 2 символа.', 'error');
    return;
  }
  const form = event.currentTarget;
  setBusy(form, true);
  const { error } = await supabase.from('profiles').upsert({
    id: currentUser.id,
    display_name: displayName,
    email: currentUser.email,
    updated_at: new Date().toISOString()
  }, { onConflict: 'id' });
  setBusy(form, false);
  if (error) {
    showNotice(profileMessage, `Не удалось сохранить профиль: ${friendlyError(error)}`, 'error');
    return;
  }
  currentProfile = { ...currentProfile, display_name: displayName };
  $('side-name').textContent = displayName;
  $('side-avatar').textContent = initials(displayName);
  $('profile-avatar').textContent = initials(displayName);
  showNotice(profileMessage, 'Профиль сохранён.', 'success');
  await loadPeople();
});

$('signup-form').addEventListener('submit', async event => {
  event.preventDefault();
  hideNotice(authMessage);
  if (!configured) {
    showNotice(authMessage, 'Сначала добавь SUPABASE_URL и SUPABASE_ANON_KEY в app.js. Инструкция есть в README.md.', 'error');
    return;
  }
  const form = event.currentTarget;
  setBusy(form, true);
  const displayName = $('signup-name').value.trim();
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: window.location.origin
    }
  });
  setBusy(form, false);
  if (error) {
    showNotice(authMessage, friendlyError(error), 'error');
    return;
  }
  if (data.session) {
    showNotice(authMessage, 'Аккаунт создан! Email уже подтверждён или подтверждение отключено.', 'success');
    await showApp(data.user);
  } else {
    showNotice(authMessage, 'Почти готово! Проверь почту и нажми на ссылку подтверждения. После подтверждения вернись на сайт и войди.', 'success');
    form.reset();
    showAuthTab('login');
    showNotice(authMessage, 'Мы отправили письмо, если адрес принят системой. Подтверди email по ссылке, затем войди.', 'success');
  }
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  hideNotice(authMessage);
  if (!configured) {
    showNotice(authMessage, 'Сначала добавь SUPABASE_URL и SUPABASE_ANON_KEY в app.js. Инструкция есть в README.md.', 'error');
    return;
  }
  const form = event.currentTarget;
  setBusy(form, true);
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  setBusy(form, false);
  if (error) {
    showNotice(authMessage, friendlyError(error), 'error');
    return;
  }
  await showApp(data.user);
});
$('logout-btn').addEventListener('click', async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) alert(friendlyError(error));
  showAuth();
});
function subscribeToAuthChanges() {
  if (authChannel && supabase) supabase.removeChannel(authChannel);
  authChannel = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) showAuth();
  }).data.subscription;
}

async function init() {
  if (!configured) {
    showNotice(authMessage, 'Чтобы включить регистрацию, подключи бесплатный проект Supabase по инструкции в README.md.', '');
    return;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error(error);
  if (data.session?.user) await showApp(data.session.user);
}
init();
