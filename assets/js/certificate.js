import { isLoggedIn } from './auth.js';
import { certificateDetail, certificateFields, formatCertificateDate } from './completion.js';

/**
 * 수료증 한 장을 그린다. 주소는 certificate.html?no=IGM-2026-0001 형태다.
 *
 * 번호만으로 열리지만 아무나 볼 수 있는 것은 아니다. 조회는 RLS 를 거치므로
 * 수강생은 자기 것만, 관리자와 담당 강사는 담당 클래스 것만 받는다.
 * 남의 번호를 넣으면 빈 결과가 온다.
 */

function setStatus(text) {
  document.getElementById('cert-status').textContent = text || '';
}

/**
 * 화면에서는 종이를 창 너비에 맞춰 줄인다. 글자 크기를 따로 계산하지 않고
 * 통째로 축소해야 화면과 인쇄물이 어긋나지 않는다.
 */
function fitToScreen() {
  const sheet = document.getElementById('sheet');
  const space = document.getElementById('sheet-space');
  if (space.hidden) return;

  const paper = sheet.getBoundingClientRect().width / (Number(
    getComputedStyle(document.documentElement).getPropertyValue('--zoom')) || 1);
  const room = document.body.clientWidth - 32;
  const zoom = Math.min(1, room / paper);
  document.documentElement.style.setProperty('--zoom', String(zoom));
}

function render(fields) {
  document.getElementById('cert-name').textContent = fields.name;
  document.getElementById('cert-course-name').textContent = fields.class_name;
  // 기수는 양식대로 괄호에 담아 작게. 값이 없으면 괄호도 그리지 않는다.
  document.getElementById('cert-batch').textContent =
    fields.batch ? ' (' + fields.batch + ')' : '';
  document.getElementById('cert-date').textContent = formatCertificateDate(fields.completed_at);
  document.getElementById('cert-no').textContent = fields.certificate_no;

  document.title = fields.name + ' 수료증 · IGM 이러닝';
  document.getElementById('sheet-space').hidden = false;
  document.getElementById('do-print').hidden = false;
  setStatus('');
  fitToScreen();
}

document.getElementById('do-print').addEventListener('click', function () { window.print(); });
window.addEventListener('resize', fitToScreen);

(async function start() {
  const no = new URLSearchParams(location.search).get('no');
  if (!no) {
    setStatus('수료증 번호가 없습니다.');
    return;
  }
  if (!isLoggedIn()) {
    setStatus('로그인이 필요합니다.');
    return;
  }

  try {
    const fields = certificateFields(await certificateDetail(no));
    if (!fields) {
      // 없는 번호와 볼 권한이 없는 번호를 구분해 알려주면 남의 수료증
      // 번호가 실재하는지 확인하는 수단이 된다. 같은 문구를 쓴다.
      setStatus('수료증을 찾을 수 없습니다.');
      return;
    }
    render(fields);
  } catch (err) {
    setStatus(err.message);
  }
})();
