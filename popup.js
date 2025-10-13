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

    // 다국어 관리자
    this.i18n = new I18nManager();

    // DOM 요소들
    this.toggleDrawingBtn = document.getElementById('toggle-drawing');
    this.maskTextBtn = document.getElementById('mask-text');
    this.areaMaskingBtn = document.getElementById('area-masking');
    this.openOptionsBtn = document.getElementById('open-options');

    this.init();
  }

  async init() {
    // 다국어 초기화
    await this.i18n.init();
    this.i18n.localizePage();

    this.setupEventListeners();
    await this.syncState();
  }

  async syncState() {
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

      // UI 업데이트
      this.updateButtonUI();
    } catch (error) {
      // 예상치 못한 에러만 로그 출력
      console.warn('상태 동기화 중 문제 발생:', error.message);
      // 오류 발생 시 기본값으로 초기화
      this.state.isDrawingMode = false;
      this.state.isAreaMaskingMode = false;
      this.updateButtonUI();
    }
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

    // 설정 페이지 열기 버튼
    this.openOptionsBtn.addEventListener('click', () => {
      this.openOptionsPage();
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

      this.updateButtonUI();
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

      this.updateButtonUI();
      this.showUIFeedback(this.areaMaskingBtn, '영역 마스킹 모드가 토글되었습니다.', 'success');
    } catch (error) {
      this.showUIFeedback(this.areaMaskingBtn, '영역 마스킹 모드 토글에 실패했습니다.', 'error');
    }
  }

  // 설정 페이지 열기
  openOptionsPage() {
    chrome.runtime.openOptionsPage();
  }

  async executeCommand(command) {
    const tab = await this.getCurrentTab();

    // content script를 실행할 수 없는 페이지인 경우 에러 발생
    if (!this.canInjectContentScript(tab.url)) {
      throw new Error('이 페이지에서는 확장 프로그램을 사용할 수 없습니다.');
    }

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

  /**
   * 현재 탭에서 content script를 실행할 수 있는지 확인
   */
  canInjectContentScript(url) {
    if (!url) return false;

    // content script를 실행할 수 없는 URL 패턴
    const restrictedPatterns = [
      'chrome://',
      'chrome-extension://',
      'about:',
      'edge://',
      'opera://',
      'vivaldi://',
      'brave://',
      'chrome.google.com/webstore'
    ];

    return !restrictedPatterns.some(pattern => url.startsWith(pattern));
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

  async getCurrentContentScriptStatus() {
    try {
      const tab = await this.getCurrentTab();

      // content script를 실행할 수 없는 페이지인 경우 조용히 null 반환
      if (!this.canInjectContentScript(tab.url)) {
        return null;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { command: 'get_status' });

      if (response && response.status === 'success') {
        return response.data;
      }
      return null;
    } catch (error) {
      // 특정 에러는 무시 (정상적인 상황)
      const isConnectionError = error.message?.includes('Could not establish connection') ||
        error.message?.includes('Receiving end does not exist');

      if (!isConnectionError) {
        // 예상치 못한 에러만 로그 출력
        console.warn('content script 상태 조회 실패:', error);
      }

      return null;
    }
  }

  updateButtonUI() {
    // 그리기 모드 버튼 UI 업데이트
    if (this.state.isDrawingMode) {
      this.toggleDrawingBtn.textContent = this.i18n.getMessage('drawing_mode_disable');
      this.toggleDrawingBtn.classList.add('active');
    } else {
      this.toggleDrawingBtn.textContent = this.i18n.getMessage('drawing_mode_enable');
      this.toggleDrawingBtn.classList.remove('active');
    }

    // 영역 마스킹 모드 버튼 UI 업데이트
    if (this.state.isAreaMaskingMode) {
      this.areaMaskingBtn.textContent = this.i18n.getMessage('area_masking_disable');
      this.areaMaskingBtn.classList.add('active');
    } else {
      this.areaMaskingBtn.textContent = this.i18n.getMessage('area_masking_enable');
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

