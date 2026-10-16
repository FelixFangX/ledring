# LEDRING Play content packs

One page, two packs. The pack follows `?src=` when that channel is known. Otherwise English uses the dev pack and Chinese uses the China pack. An explicit language choice (`?lang=` or the language toggle) changes the language only. The toggle stores `ledring-lang-explicit` so a saved channel does not switch it back. The channel itself is stored as `ledring-src`.

| `src` | Language | Pack | Onboarding | Ending |
| --- | --- | --- | --- | --- |
| `x`, `hn`, `reddit` | English | Dev | Full | Star the repo, run from source, view source |
| `v2ex` | Chinese | China | Full | Share card |
| `xhs`, `douyin` | Chinese | China | Skipped. Start opens the four presets. | Share card |

Dev presets stay the code and tool ideas: snake, pomodoro, pixel paint, bill split. Ending links:

- Star the repo: https://github.com/FelixFangX/ledring
- Run from source (not on npm yet): https://github.com/FelixFangX/ledring#quickstart
- View source: https://github.com/FelixFangX/ledring/blob/main/packages/play-web/index.html

A China-pack run uses one timed choice (8 seconds) and a 3.6 second Red Wall. With the plan and the build, a phone run stays inside 1–2 minutes. Dev runs keep two choices and the 4.5 second wall. `?idea=snake` still plays the dev preset in either language.

## China-pack presets

| id | Page | Idea | Risk in the demo |
| --- | --- | --- | --- |
| `confess` | 告白页 | 做一个告白页，输入名字，点一下亮出那句话 | `localStorage` |
| `slack` | 摸鱼 | 做一个上班摸鱼小游戏，老板回头就切回表格 | `fetch` |
| `bday` | 生日贺卡 | 做一张生日贺卡，写上名字，点开就是祝福 | `window.open` |
| `fortune` | 今日运势 | 做一个今日运势页，输入生日，给一句短签 | `eval` |

## Wall copy

China presets use this Red Wall line. `{what}` is the detected category. `{meme}` is the preset line below. The timeout still allows the item if Block is not chosen.

检测到：{what}。这波有点像{meme}。要阻止它，请在倒计时结束前点击「拦截」；超时将放行。

| Preset | Meme |
| --- | --- |
| 告白页 | 已读不回 |
| 摸鱼 | 摸鱼被抓 |
| 生日贺卡 | 群里突然@所有人 |
| 今日运势 | AI 删库 |

Rendered example for 摸鱼 (fetch): 检测到：网络请求。这波有点像摸鱼被抓。要阻止它，请在倒计时结束前点击「拦截」；超时将放行。

The dev pack keeps the plain detected-risk sentence.

## Share-card verdicts

The China ending is one card, meant to be screenshotted on a phone. The line depends on the ending.

| Ending | Verdict |
| --- | --- |
| POLISHED | 能用，而且好看。可以发了。 |
| SHIPPED | 能打开。先发朋友圈。 |
| BUGGY | 有报错。截图也算交作业。 |
| FAKE | 测试全绿，但可能是装的。 |
| COMPROMISED | 你放行了。AI 删库，往往从这一下开始。 |
| BROKEN | 这页没写出来。想法还在。 |
| ABANDONED | 停得挺及时。 |
