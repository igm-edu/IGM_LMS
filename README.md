# IGM_LMS

IGM 공개과정 e러닝 LMS. GitHub Pages(프론트) + Google Apps Script(API) + Google Sheets(DB) 구성이다.

## 문서

- 설계: `docs/superpowers/specs/2026-08-05-lms-design.md`
- 구현 계획: `docs/superpowers/plans/`

## 개발

테스트는 저장소 루트에서 실행한다. 외부 의존성 없이 Node 내장 테스트 러너만 쓴다.

```bash
npm test
```

Apps Script 코드 업로드는 `apps-script/` 안에서 한다. `.clasp.json`이 그 폴더에 있다.

```bash
cd apps-script && clasp push
```

`apps-script/` 아래 코드는 clasp로 관리한다. 웹 편집기에서 직접 고치면 저장소와 어긋나므로, 수정은 항상 로컬에서 하고 `clasp push`로 올린다.

Apps Script는 자체 런타임에서 단위 테스트를 할 수 없다. 그래서 각 소스 파일 끝에 `if (typeof module !== 'undefined')` 가드를 두어 Node에서도 로드되게 하고, `test/helpers/`의 메모리 대역(`Utilities`, `CacheService`, `PropertiesService`, `SpreadsheetApp`)을 상대로 검증한다. 대역이 실제 Google보다 관대하면 테스트가 통과해도 운영에서 깨지므로, 실제 제약을 발견할 때마다 대역에 반영한다.

## 최초 구축 순서

1. 스프레드시트를 만들고 URL에서 ID를 확인한다.
2. Apps Script 프로젝트 설정 > 스크립트 속성에 `SPREADSHEET_ID`를 등록한다. **코드나 저장소에 넣지 않는다.** 이 스프레드시트에는 수강생 개인정보가 들어가고 이 저장소는 공개 상태다.
3. 편집기에서 `setupSheets()`를 실행해 13개 시트를 만든다.
4. 스크립트 속성에 `SEED_ADMIN_EMAIL`과 `SEED_ADMIN_PASSWORD`를 등록하고(이름을 넣으려면 `SEED_ADMIN_NAME`도) `seedAdmin()`을 실행한다. 계정이 만들어지면 세 속성은 자동으로 삭제된다.

`seedAdmin`이 인자 대신 스크립트 속성을 읽는 이유는, Apps Script 편집기의 실행 버튼이 인자 없는 함수만 호출할 수 있기 때문이다. 임시 래퍼 함수에 비밀번호를 적으면 `clasp pull` 한 번으로 공개 저장소에 들어갈 수 있다.

`setupSheets()`는 몇 번을 실행해도 기존 시트를 지우거나 비우지 않는다. 열이 추가되면 빠진 헤더만 뒤에 덧붙인다. 전체 삭제는 `resetAllSheets()` 한 곳에만 있고 확인 문자열을 인자로 넘겨야만 동작하며, 운영 중에는 사용하지 않는다.

## 알려진 한계

비밀번호 해싱 반복 횟수는 3,000회다. OWASP 권고는 60만 회지만 Apps Script는 HMAC을 API 호출로 처리해 호출당 약 0.47ms가 들고, 권고치를 지키면 로그인 한 번에 4분 이상이 걸린다. 스프레드시트가 유출되면 약한 비밀번호는 오프라인 공격에 무너진다고 보아야 한다. 자세한 판단 근거와 대체 방어선은 설계 문서 7장에 있다.

## 주의

- 교육생·임원 개인정보가 포함된 파일은 커밋하지 않는다.
- 스프레드시트 ID, 계정 정보, API 키는 스크립트 속성이나 `.env`로 분리한다. `.gitignore`가 `.env`와 `.clasprc.json`을 제외한다.
