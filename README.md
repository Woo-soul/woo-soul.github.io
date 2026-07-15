# Multi-channel Bioimpedance Serial Plotter

Chrome 또는 Edge에서 Web Serial API로 USB Serial / UART 데이터를 직접 읽고, bioimpedance magnitude/phase 값을 실시간으로 plot하는 정적 웹앱입니다.

서버, Python, Node.js 없이 정적 파일만으로 동작합니다. Plot 라이브러리는 CDN에서 uPlot을 불러옵니다.

## File Structure

```text
index.html                         # main hub page
style.css                          # main hub style
README.md
projects/
  bioimpedance/
    index.html                     # bioimpedance serial GUI
    style.css
    app.js
```

GitHub Pages 주소로 접속하면 먼저 main hub가 열립니다. `Multi-channel Bioimpedance Serial Plotter` 카드를 누르면 실제 측정 GUI로 들어갑니다.

## Important Architecture

GitHub 서버가 serial 데이터를 받는 구조가 아닙니다.

```text
MCU / USB Serial / UART
        ↓
사용자의 Chrome 또는 Edge 브라우저
        ↓
Web Serial API로 로컬 COM port 읽기
        ↓
브라우저 안에서 parsing, plot, CSV 저장
```

GitHub Pages는 HTML/CSS/JS 파일을 HTTPS 웹사이트로 배포할 뿐입니다. Serial 데이터는 사용자의 브라우저와 로컬 컴퓨터 안에서 처리됩니다.

## MCU Serial Output Format

MCU는 newline으로 끝나는 CSV 한 줄을 계속 출력해야 합니다.

기본값은 12 channel이며, 각 channel마다 magnitude와 phase가 있습니다. 따라서 한 줄에는 `channel_count * 2`개의 숫자가 정확히 있어야 합니다.

기본 interleaved format:

```text
ch1_mag,ch1_phase,ch2_mag,ch2_phase,...,ch12_mag,ch12_phase
```

예:

```text
67.451,0.048,67.428,0.067,67.434,0.060,67.500,0.055,67.481,0.052,67.490,0.050,67.455,0.049,67.438,0.064,67.470,0.058,67.462,0.053,67.477,0.051,67.468,0.056
```

grouped format:

```text
ch1_mag,ch2_mag,...,ch12_mag,ch1_phase,ch2_phase,...,ch12_phase
```

빈 줄, header line, 문자 포함 line, 값 개수 mismatch, `NaN`, `Infinity`, `-Infinity`가 들어간 line은 invalid line으로 버리고 parsing error count만 증가시킵니다.

## GUI Layout

상세 GUI는 다음 구조입니다.

```text
top control panel
compact serial status strip
magnitude plot | phase plot
formula plot
```

Magnitude plot과 phase plot은 가로로 나란히 배치되어 한 화면에서 같이 볼 수 있습니다. 점 marker는 끄고, 수신된 sample들을 선으로 이어서 표시합니다.

## Formula Plot

Formula Plot에서는 channel 값을 조합해서 새로운 trace를 만들 수 있습니다.

지원 문법:

- `ch1`, `ch2`, ..., `chN`
- 숫자
- 괄호
- `+`, `-`, `*`, `/`

예:

```text
ch1 - ch2
(ch1 + ch2) / 2
ch3 / ch4
ch1 * 0.5
```

사용 방법:

1. Source에서 `Magnitude` 또는 `Phase`를 고릅니다.
2. Formula에 `ch1 - ch2` 같은 식을 입력합니다.
3. Label은 비워도 되고 원하는 이름을 넣어도 됩니다.
4. `Add trace`를 누르면 아래 Formula Plot에 추가됩니다.
5. `Clear formulas`를 누르면 formula trace가 모두 삭제됩니다.

Formula는 임의 JavaScript를 실행하지 않습니다. 앱 내부 parser가 channel, 숫자, 괄호, 사칙연산만 허용합니다.

## Basic Use

1. Chrome 또는 Edge에서 페이지를 엽니다.
2. Baudrate를 MCU 설정과 맞춥니다.
3. Channel count를 실제 channel 수로 설정합니다. 기본값은 `12`입니다.
4. Input format을 `interleaved` 또는 `grouped`로 선택합니다.
5. Display window seconds를 설정합니다. 기본값은 최근 `10`초입니다.
6. Expected sample rate를 설정합니다. 기본값은 `5 Hz`입니다.
7. `Connect`를 누르고 브라우저 팝업에서 MCU가 연결된 COM port를 직접 선택합니다.

Web Serial API 보안 정책상 앱이 자동으로 COM port를 선택할 수 없습니다. 사용자가 반드시 `Connect` 버튼을 누르고 직접 port를 선택해야 합니다.

## Baudrate / Channel Count

Baudrate 후보:

- `115200`
- `230400`
- `460800`
- `921600`
- `1000000`

Baudrate는 serial port를 열 때 적용됩니다. 연결 중 baudrate를 바꾸려면 disconnect 후 다시 connect하세요.

Channel count는 실제 MCU가 출력하는 channel 수와 일치해야 합니다. 예를 들어 12 channel이면 한 줄에 24개 숫자가 있어야 합니다.

## CSV Logging

`Start logging`을 누르면 이후 수신되는 valid frame이 브라우저 메모리에 저장됩니다.

`Stop logging`을 누르면 CSV 파일이 다운로드됩니다.

CSV header:

```text
timestamp_ms,ch1_mag,ch1_phase,ch2_mag,ch2_phase,...,chN_mag,chN_phase
```

CSV 저장은 브라우저에서만 수행됩니다. 서버로 업로드되지 않습니다.

## GitHub Pages Deployment

1. GitHub에서 새 repository를 만듭니다.
2. 이 폴더의 파일을 repository에 올립니다.
   - `index.html`
   - `style.css`
   - `README.md`
   - `projects/bioimpedance/index.html`
   - `projects/bioimpedance/style.css`
   - `projects/bioimpedance/app.js`
3. GitHub repository에서 `Settings`로 이동합니다.
4. 왼쪽 메뉴의 `Pages`를 엽니다.
5. `Build and deployment`에서 `Deploy from a branch`를 선택합니다.
6. Branch는 보통 `main`, folder는 `/root`를 선택합니다.
7. 저장 후 잠시 기다리면 GitHub Pages URL이 생깁니다.

가장 짧은 추천 주소:

```text
https://woo-soul.github.io/index.html
```

이 주소를 쓰려면 GitHub username이 `woo-soul`이어야 하고, repository 이름을 `woo-soul.github.io`로 만들면 됩니다.

GitHub username이 다른 경우에는 repository 이름을 원하는 이름으로 만들어 다음 형태를 쓰는 것이 가장 단순합니다.

```text
https://YOUR_ID.github.io/REPOSITORY_NAME/
```

Main hub:

```text
https://YOUR_ID.github.io/REPOSITORY_NAME/
```

Bioimpedance GUI:

```text
https://YOUR_ID.github.io/REPOSITORY_NAME/projects/bioimpedance/index.html
```

GitHub Pages에서는 `/projects/bioimpedance/`도 보통 `index.html`로 열리지만, 로컬에서 파일을 직접 열 때 폴더 목록이 뜨는 일을 피하려면 `index.html`까지 명시하는 편이 안전합니다.

## Recommended Browser

Web Serial API는 모든 브라우저에서 안정적으로 지원되는 기능이 아닙니다. Chrome 또는 Edge 최신 버전에서 테스트하는 것을 권장합니다.

## Troubleshooting

### `navigator.serial` is undefined

원인:

- Chrome/Edge가 아닌 브라우저를 사용 중입니다.
- HTTPS 또는 localhost가 아닌 환경에서 열었습니다.
- 브라우저/OS 정책으로 Web Serial이 막혀 있습니다.

해결:

- Chrome 또는 Edge 최신 버전을 사용하세요.
- GitHub Pages의 `https://...github.io/...` 주소에서 여세요.
- 로컬 테스트는 `http://localhost` 또는 `http://127.0.0.1` 서버로 여세요.

### COM port busy

하나의 COM port는 보통 여러 프로그램이 동시에 열 수 없습니다.

Tera Term, Arduino Serial Monitor, SerialPlot, Python script, 다른 GUI 프로그램이 같은 port를 열고 있으면 이 웹앱이 연결하지 못할 수 있습니다.

### Connected인데 plot이 비어 있음

상단 status strip의 `RX bytes`, `Lines`, `Buffered`, `Errors`를 확인하세요.

```text
RX bytes = 0
```

브라우저가 실제 serial byte를 받지 못하고 있습니다. wrong COM port, MCU 출력 중지, USB/드라이버 문제, baudrate 문제 등을 확인하세요.

```text
RX bytes > 0, Lines = 0, Buffered 증가
```

바이트는 들어오지만 newline으로 끝나는 완성된 줄이 오지 않는 상태입니다. MCU가 각 frame 끝에 `\n` 또는 `\r\n`을 보내는지 확인하세요.

```text
Lines > 0, Errors 증가, Frames = 0
```

줄은 들어오지만 CSV 형식이 앱 설정과 맞지 않습니다. Channel count, interleaved/grouped 설정, 값 개수, 문자/header, `NaN`/`Infinity` 포함 여부를 확인하세요.

### Baudrate mismatch

MCU baudrate와 웹앱 baudrate가 다르면 값이 깨지거나 parsing error가 증가합니다. MCU firmware의 baudrate와 앱의 baudrate를 동일하게 맞추고 reconnect하세요.

### Value count mismatch

예를 들어 channel count가 `12`이면 한 줄에 숫자가 정확히 `24`개 있어야 합니다.

### `file://`로 열었을 때 동작하지 않음

Web Serial은 보안 컨텍스트에서 동작해야 합니다. GitHub Pages처럼 HTTPS로 열거나, 로컬 테스트는 `localhost` 서버로 여는 것을 권장합니다.

간단한 로컬 테스트 예:

```bash
python -m http.server 8000
```

그 다음 브라우저에서:

```text
http://127.0.0.1:8000/
```

## References

- [MDN Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [Chrome Web Serial API guide](https://developer.chrome.com/docs/capabilities/serial)
- [GitHub Pages docs](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
