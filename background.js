// 확장프로그램 설치 시 초기화
chrome.runtime.onInstalled.addListener(() => {
  // 필요시 초기 설정 작업 수행
});

// 단축키 명령 처리
chrome.commands.onCommand.addListener(async (command) => {
  // 현재 활성 탭 가져오기
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    return;
  }

  try {
    // content script로 명령 전송
    await chrome.tabs.sendMessage(tab.id, { command: command });
  } catch (error) {
    // content script가 아직 로드되지 않은 경우 다시 시도
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });

      // CSS도 함께 주입
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['styles.css']
      });

      // 잠시 대기 후 다시 시도
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { command: command });
        } catch (retryError) {
          // 재시도 실패 시 무시
        }
      }, 200);
    } catch (scriptError) {
      // 주입 실패 시 무시
    }
  }
});

// 확장프로그램 아이콘 클릭 시 팝업 표시
chrome.action.onClicked.addListener(async (tab) => {
  // 기본적으로 popup.html이 표시됨
});

// 메시지 수신 처리 (content script에서 background로 메시지 보낼 때)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 설정 페이지 열기 명령 처리
  if (request.command === 'open_options') {
    chrome.runtime.openOptionsPage((success) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true; // 비동기 응답을 위해 true 반환
  }

  // 기타 메시지 처리
  return true; // 비동기 응답을 위해 true 반환
});

// 탭 업데이트 감지 (페이지 새로고침 등)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 필요시 페이지 로드 완료 후 작업 수행
});

