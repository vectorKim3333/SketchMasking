class SketchMaskingPopup {
  constructor() {
    // 상수 정의
    this.CONSTANTS = {
      FEEDBACK_DURATION: 1500,
      ERROR_DURATION: 2000,
      CONTENT_SCRIPT_RELOAD_DELAY: 200,
      COMMANDS: {
        TOGGLE_DRAWING: 'toggle_drawing_mode',
        MASK_TEXT: 'mask_selected_text'
      },
      KEYBOARD_SHORTCUTS: {
        DRAWING_MODE: '1',
        MASK_TEXT: '2'
      }
    };

    // DOM 요소들
    this.drawingStatus = document.getElementById('drawing-status');
    this.toggleDrawingBtn = document.getElementById('toggle-drawing');
    this.maskTextBtn = document.getElementById('mask-text');

    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.updateStatus();
  }

  setupEventListeners() {
    // 그리기 모드 토글 버튼
    this.toggleDrawingBtn.addEventListener('click', () => {
      this.handleCommand(
        this.CONSTANTS.COMMANDS.TOGGLE_DRAWING,
        '그리기 모드가 토글되었습니다.',
        '그리기 모드 토글에 실패했습니다.'
      );
    });

    // 텍스트 마스킹 버튼
    this.maskTextBtn.addEventListener('click', async () => {
      try {
        await this.executeCommand(this.CONSTANTS.COMMANDS.MASK_TEXT);
        this.showUIFeedback(this.maskTextBtn, '선택된 텍스트가 마스킹되었습니다.', 'success');
        setTimeout(() => window.close(), 500); // 팝업 닫기 (약간의 지연)
      } catch (error) {
        this.showUIFeedback(
          this.maskTextBtn,
          '텍스트 마스킹에 실패했습니다. 텍스트를 먼저 선택해주세요.',
          'error'
        );
      }
    });

    // 키보드 단축키 처리
    this.setupKeyboardShortcuts();
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (!this.isValidShortcutEvent(e)) return;

      if (e.key === this.CONSTANTS.KEYBOARD_SHORTCUTS.DRAWING_MODE) {
        e.preventDefault();
        this.toggleDrawingBtn.click();
      } else if (e.key === this.CONSTANTS.KEYBOARD_SHORTCUTS.MASK_TEXT) {
        e.preventDefault();
        this.maskTextBtn.click();
      }
    });
  }

  isValidShortcutEvent(e) {
    return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  }

  async handleCommand(command, successMessage, errorMessage) {
    try {
      await this.executeCommand(command);
      this.showUIFeedback(this.toggleDrawingBtn, successMessage, 'success');
    } catch (error) {
      this.showUIFeedback(this.toggleDrawingBtn, errorMessage, 'error');
    }
  }

  async executeCommand(command) {
    const tab = await this.getCurrentTab();

    try {
      await chrome.tabs.sendMessage(tab.id, { command });
    } catch (error) {
      console.warn('Content script 재로드 중...');
      await this.reloadContentScript(tab.id);
      await chrome.tabs.sendMessage(tab.id, { command });
    }
  }

  async getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('활성 탭을 찾을 수 없습니다.');
    }

    return tab;
  }

  async reloadContentScript(tabId) {
    try {
      // content script 주입
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });

      // CSS도 함께 주입
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['styles.css']
      });

      // 스크립트 로드 대기
      await new Promise(resolve =>
        setTimeout(resolve, this.CONSTANTS.CONTENT_SCRIPT_RELOAD_DELAY)
      );

      console.log('Content script 재주입 완료');
    } catch (retryError) {
      console.error('재주입 실패:', retryError);
      throw new Error('명령 실행에 실패했습니다. 페이지를 새로고침 후 다시 시도해주세요.');
    }
  }

  async updateStatus() {
    try {
      // 현재 그리기 모드 상태 확인 (구현 필요시)
      // 지금은 기본 상태로 표시
      this.setDrawingStatus(false);
    } catch (error) {
      console.error('상태 업데이트 실패:', error);
    }
  }

  setDrawingStatus(isActive) {
    if (isActive) {
      this.drawingStatus.textContent = '그리기 모드: 활성';
      this.drawingStatus.className = 'status active';
      this.toggleDrawingBtn.textContent = '그리기 모드 비활성화';
    } else {
      this.drawingStatus.textContent = '그리기 모드: 비활성';
      this.drawingStatus.className = 'status inactive';
      this.toggleDrawingBtn.textContent = '그리기 모드 활성화';
    }
  }

  showUIFeedback(element, message, type = 'info') {
    const originalText = element.textContent;
    const originalBackground = element.style.background;

    // 타입별 아이콘 및 색상 설정
    const feedbackConfig = {
      success: { color: '#4CAF50', duration: this.CONSTANTS.FEEDBACK_DURATION },
      error: { color: '#f44336', duration: this.CONSTANTS.ERROR_DURATION },
      info: { color: '#2196F3', duration: this.CONSTANTS.FEEDBACK_DURATION }
    };

    const config = feedbackConfig[type] || feedbackConfig.info;

    // UI 업데이트
    element.textContent = `${message}`;
    element.style.background = config.color;
    element.disabled = true;

    // 원래 상태로 복원
    setTimeout(() => {
      element.textContent = originalText;
      element.style.background = originalBackground;
      element.disabled = false;
    }, config.duration);
  }
}

// 팝업 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  new SketchMaskingPopup();
});

