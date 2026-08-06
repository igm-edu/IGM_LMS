import { signup, login, logout, me, isLoggedIn } from './auth.js';

const views = {
  login: document.getElementById('view-login'),
  signup: document.getElementById('view-signup'),
  home: document.getElementById('view-home'),
};

function show(name) {
  Object.keys(views).forEach(function (key) {
    views[key].hidden = key !== name;
  });
}

/** 사용자 입력과 서버 응답은 textContent로만 넣는다. */
function setMessage(id, text) {
  document.getElementById(id).textContent = text || '';
}

function showHome(user) {
  document.getElementById('home-name').textContent = user.name;
  document.getElementById('home-company').textContent = user.company ? ' · ' + user.company : '';
  show('home');
}

function formValues(form) {
  const data = {};
  new FormData(form).forEach(function (value, key) { data[key] = value; });
  return data;
}

function busy(form, on) {
  form.querySelector('button[type="submit"]').disabled = on;
}

document.getElementById('go-signup').addEventListener('click', function () {
  setMessage('message-signup', '');
  show('signup');
});

document.getElementById('go-login').addEventListener('click', function () {
  setMessage('message-login', '');
  show('login');
});

document.getElementById('form-login').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-login', '');
  busy(form, true);
  try {
    const values = formValues(form);
    showHome(await login(values.email, values.password));
    form.reset();
  } catch (err) {
    setMessage('message-login', err.message);
  } finally {
    busy(form, false);
  }
});

document.getElementById('form-signup').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-signup', '');

  const values = formValues(form);
  values.consent = form.querySelector('input[name="consent"]').checked;
  if (!values.consent) {
    setMessage('message-signup', '개인정보 수집·이용에 동의해야 가입할 수 있습니다.');
    return;
  }

  busy(form, true);
  try {
    showHome(await signup(values));
    form.reset();
  } catch (err) {
    setMessage('message-signup', err.message);
  } finally {
    busy(form, false);
  }
});

document.getElementById('do-logout').addEventListener('click', async function () {
  await logout();
  show('login');
});

// 새로고침해도 로그인이 유지되게 한다. 토큰이 죽었으면 auth.js가 지우고
// 여기서는 로그인 화면으로 돌아간다.
(async function start() {
  if (!isLoggedIn()) {
    show('login');
    return;
  }
  try {
    showHome(await me());
  } catch (err) {
    show('login');
  }
})();
