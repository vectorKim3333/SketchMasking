class SketchMaskingPopup {
  constructor() {
    // 상수 정의
    this.CONSTANTS = {
      FEEDBACK_DURATION: 1500,
      ERROR_DURATION: 2000,
      CONTENT_SCRIPT_RELOAD_DELAY: 200,
      COMMANDS: {
        TOGGLE_DRAWING: 'toggle_drawing_mode',
        MASK_TEXT: 'mask_selected_text',
        TOGGLE_AREA_MASKING: 'toggle_area_masking'
      },
      KEYBOARD_SHORTCUTS: {
        DRAWING_MODE: '1',
        MASK_TEXT: '2',
        AREA_MASKING: '3'
      }
    };

    // 각 모드의 상태 관리
    this.state = {
      isDrawingMode: false,
      isAreaMaskingMode: false
    };

    // DOM 요소들
    this.drawingStatus = document.getElementById('drawing-status');
    this.areaMaskingStatus = document.getElementById('area-masking-status');
    this.toggleDrawingBtn = document.getElementById('toggle-drawing');
    this.maskTextBtn = document.getElementById('mask-text');
    this.areaMaskingBtn = document.getElementById('area-masking');

    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.updateStatus();
  }

  setupEventListeners() {
    // 그리기 모드 토글 버튼
    this.toggleDrawingBtn.addEventListener('click', () => {
      this.handleDrawingModeToggle();
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

    // 영역 마스킹 버튼
    this.areaMaskingBtn.addEventListener('click', () => {
      this.handleAreaMaskingToggle();
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
      } else if (e.key === this.CONSTANTS.KEYBOARD_SHORTCUTS.AREA_MASKING) {
        e.preventDefault();
        this.areaMaskingBtn.click();
      }
    });
  }

  isValidShortcutEvent(e) {
    return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  }

  // 그리기 모드 토글 전용 핸들러
  async handleDrawingModeToggle() {
    try {
      await this.executeCommand(this.CONSTANTS.COMMANDS.TOGGLE_DRAWING);

      // 명령 실행 후 실제 상태를 다시 가져와서 동기화
      const currentStatus = await this.getCurrentContentScriptStatus();
      if (currentStatus) {
        this.state.isDrawingMode = currentStatus.isDrawingMode;
        this.state.isAreaMaskingMode = currentStatus.isAreaMaskingMode;
      }

      this.updateDrawingModeUI();
      this.updateAreaMaskingUI();
      this.showUIFeedback(this.toggleDrawingBtn, '그리기 모드가 토글되었습니다.', 'success');
    } catch (error) {
      this.showUIFeedback(this.toggleDrawingBtn, '그리기 모드 토글에 실패했습니다.', 'error');
    }
  }

  // 영역 마스킹 모드 토글 전용 핸들러
  async handleAreaMaskingToggle() {
    try {
      await this.executeCommand(this.CONSTANTS.COMMANDS.TOGGLE_AREA_MASKING);

      // 명령 실행 후 실제 상태를 다시 가져와서 동기화
      const currentStatus = await this.getCurrentContentScriptStatus();
      if (currentStatus) {
        this.state.isDrawingMode = currentStatus.isDrawingMode;
        this.state.isAreaMaskingMode = currentStatus.isAreaMaskingMode;
      }

      this.updateDrawingModeUI();
      this.updateAreaMaskingUI();
      this.showUIFeedback(this.areaMaskingBtn, '영역 마스킹 모드가 토글되었습니다.', 'success');
    } catch (error) {
      this.showUIFeedback(this.areaMaskingBtn, '영역 마스킹 모드 토글에 실패했습니다.', 'error');
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
      // content script로부터 현재 상태 가져오기
      const currentStatus = await this.getCurrentContentScriptStatus();

      if (currentStatus) {
        this.state.isDrawingMode = currentStatus.isDrawingMode;
        this.state.isAreaMaskingMode = currentStatus.isAreaMaskingMode;
      } else {
        // content script와 통신 실패 시 기본값으로 초기화
        this.state.isDrawingMode = false;
        this.state.isAreaMaskingMode = false;
      }

      this.updateDrawingModeUI();
      this.updateAreaMaskingUI();
    } catch (error) {
      console.error('상태 업데이트 실패:', error);
      // 오류 발생 시 기본값으로 초기화
      this.state.isDrawingMode = false;
      this.state.isAreaMaskingMode = false;
      this.updateDrawingModeUI();
      this.updateAreaMaskingUI();
    }
  }

  async getCurrentContentScriptStatus() {
    try {
      const tab = await this.getCurrentTab();
      const response = await chrome.tabs.sendMessage(tab.id, { command: 'get_status' });

      if (response && response.status === 'success') {
        return response.data;
      }
      return null;
    } catch (error) {
      console.warn('content script 상태 조회 실패:', error);
      return null;
    }
  }

  updateDrawingModeUI() {
    if (this.state.isDrawingMode) {
      this.drawingStatus.textContent = '그리기 모드: 활성';
      this.drawingStatus.className = 'status active';
      this.toggleDrawingBtn.textContent = '그리기 모드 비활성화';
      this.toggleDrawingBtn.classList.add('active');
    } else {
      this.drawingStatus.textContent = '그리기 모드: 비활성';
      this.drawingStatus.className = 'status inactive';
      this.toggleDrawingBtn.textContent = '그리기 모드 활성화';
      this.toggleDrawingBtn.classList.remove('active');
    }
  }

  updateAreaMaskingUI() {
    if (this.state.isAreaMaskingMode) {
      this.areaMaskingStatus.textContent = '영역 마스킹 모드: 활성';
      this.areaMaskingStatus.className = 'status active';
      this.areaMaskingBtn.textContent = '영역 마스킹 비활성화';
      this.areaMaskingBtn.classList.add('active');
    } else {
      this.areaMaskingStatus.textContent = '영역 마스킹 모드: 비활성';
      this.areaMaskingStatus.className = 'status inactive';
      this.areaMaskingBtn.textContent = '영역 마스킹 활성화';
      this.areaMaskingBtn.classList.remove('active');
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

