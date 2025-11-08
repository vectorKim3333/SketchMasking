class SketchMasking {
  constructor() {
    // 기본 설정값 (settings로부터 오버라이드됨)
    this.settings = {
      drawing: {
        lineColor: '#FF0000',
        lineWidth: 2,
        toolbarCollapsed: false
      },
      textMasking: {
        maskingChar: '*'
      },
      areaBlur: {
        blurIntensity: 10
      }
    };

    // 상수 정의 (설정값으로 오버라이드될 수 있음)
    this.CONSTANTS = {
      DEFAULT_TOOL: 'rectangle',
      MIN_SCREEN_WIDTH: 1920,
      MIN_SCREEN_HEIGHT: 1080,
      Z_INDEX_OVERLAY: 2147483647,
      Z_INDEX_NOTIFICATION: 2147483648,
      NOTIFICATION_DURATION: 1000,
      TOOLBAR_UPDATE_DELAY: 10
    };

    // 도구 설정 (다국어 키 사용)
    this.TOOLS = [
      { name: 'rectangle', icon: '▢', titleKey: 'tool_box' },
      { name: 'circle', icon: '○', titleKey: 'tool_circle' },
      { name: 'pen', icon: '✎', titleKey: 'tool_pen' },
      { name: 'line', icon: '/', titleKey: 'tool_line' },
      { name: 'settings', icon: '⚙️', titleKey: 'tool_settings' },
      { name: 'close', icon: '✕', titleKey: 'tool_close' }
    ];

    // 상태 변수들
    this.isDrawingMode = false;
    this.isAreaMaskingMode = false;
    this.currentTool = this.CONSTANTS.DEFAULT_TOOL;
    this.isDrawing = false;

    // 좌표
    this.startX = 0;
    this.startY = 0;

    // DOM 요소들
    this.canvas = null;
    this.ctx = null;
    this.overlay = null;
    this.tempCanvas = null;
    this.tempCtx = null;
    this.toolbar = null;
    this.toolbarContainer = null;
    this.toggleButton = null;

    // 데이터
    this.paths = [];
    this.maskedElements = [];
    this.areaMasks = []; // 영역 마스킹 정보 저장

    this.init();
  }

  async init() {
    // 설정 로드
    await this.loadSettings();

    // 메시지/단축키 리스너와 설정 변경 리스너만 초기화
    // 오버레이는 사용자 동작(팝업/단축키)으로 모드 활성화 시 생성
    this.setupKeyboardShortcuts();
    this.setupSettingsListener();
  }

  /**
   * 오버레이와 관련 요소들이 필요한 시점에만 생성
   */
  ensureOverlay() {
    if (this.overlay) return;

    // 오버레이 및 관련 캔버스/툴바 생성
    this.createOverlay();
    this.setupEventListeners();

    // 생성 직후 버튼 상태 동기화
    this.updateToolbarButtons();
  }

  /**
   * 설정 로드
   */
  async loadSettings() {
    try {
      const result = await new Promise((resolve, reject) => {
        chrome.storage.local.get(['sketchMaskingSettings'], (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        });
      });

      // 저장된 설정이 있으면 기본값과 병합
      if (result.sketchMaskingSettings && typeof result.sketchMaskingSettings === 'object') {
        this.settings = this.mergeSettings(this.settings, result.sketchMaskingSettings);
      }
      // 저장된 설정이 없으면 기본값 그대로 사용 (이미 constructor에서 설정됨)

    } catch (error) {
      console.warn('설정 로드 실패, 기본값 사용:', error);
      // 오류 발생 시 기본값 그대로 사용 (이미 constructor에서 설정됨)
    }
  }

  /**
   * 설정 병합 (깊은 병합, 안전성 강화)
   */
  mergeSettings(defaultSettings, userSettings) {
    const merged = JSON.parse(JSON.stringify(defaultSettings));

    // null이나 undefined 체크
    if (!userSettings || typeof userSettings !== 'object') {
      return merged;
    }

    Object.keys(userSettings).forEach(category => {
      if (merged[category] &&
        userSettings[category] &&
        typeof userSettings[category] === 'object') {
        Object.keys(userSettings[category]).forEach(key => {
          // 기본값에 해당 키가 존재하는지 확인
          if (merged[category].hasOwnProperty(key)) {
            const userValue = userSettings[category][key];
            // 타입이 일치하는지 확인
            if (typeof userValue === typeof merged[category][key]) {
              merged[category][key] = userValue;
            }
          }
        });
      }
    });

    return merged;
  }

  /**
   * 설정 변경 리스너 설정
   */
  setupSettingsListener() {
    // storage 변경 이벤트 리스너
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.sketchMaskingSettings) {
        console.log('설정 변경 감지, 업데이트 중...');
        this.loadSettings().then(() => {
          this.applySettings();
        });
      }
    });
  }

  /**
   * 설정 적용
   */
  applySettings() {
    // 그리기 설정 적용
    if (this.ctx) {
      this.setupCanvasContext(this.ctx);
    }
    if (this.tempCtx) {
      this.setupCanvasContext(this.tempCtx);
    }

    // 도구바 접힘 상태 적용
    if (this.toolbar && this.isDrawingMode) {
      if (this.settings.drawing.toolbarCollapsed !== (this.toolbar.classList.contains('collapsed'))) {
        this.toggleToolbar();
      }
    }

    console.log('설정 적용 완료');
  }

  // 유틸리티 메서드들
  getScreenDimensions() {
    const screenWidth = Math.max(
      window.innerWidth,
      document.documentElement.clientWidth,
      this.CONSTANTS.MIN_SCREEN_WIDTH
    );
    const screenHeight = Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
      this.CONSTANTS.MIN_SCREEN_HEIGHT
    );
    return { width: screenWidth, height: screenHeight };
  }

  setupCanvasContext(ctx) {
    ctx.strokeStyle = this.settings.drawing.lineColor;
    ctx.lineWidth = this.settings.drawing.lineWidth;
    ctx.lineCap = 'round';
  }

  createCanvas(className, dimensions) {
    const canvas = document.createElement('canvas');
    canvas.className = className;
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    canvas.style.width = dimensions.width + 'px';
    canvas.style.height = dimensions.height + 'px';

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.setupCanvasContext(ctx);

    return { canvas, ctx };
  }

  updateCanvasSize(canvas, ctx, dimensions) {
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    canvas.style.width = dimensions.width + 'px';
    canvas.style.height = dimensions.height + 'px';
    this.setupCanvasContext(ctx);
  }

  createOverlay() {
    const dimensions = this.getScreenDimensions();

    // 메인 오버레이 div 생성
    this.overlay = document.createElement('div');
    this.overlay.id = 'sketch-masking-overlay';
    this.overlay.style.width = dimensions.width + 'px';
    this.overlay.style.height = dimensions.height + 'px';
    // 초기에는 숨김 상태
    this.overlay.style.display = 'none';
    this.overlay.style.pointerEvents = 'none';

    // 메인 캔버스 생성
    const mainCanvas = this.createCanvas('sketch-canvas', dimensions);
    this.canvas = mainCanvas.canvas;
    this.ctx = mainCanvas.ctx;

    // 임시 캔버스 생성 (도형 그리기용)
    const tempCanvas = this.createCanvas('sketch-temp-canvas', dimensions);
    this.tempCanvas = tempCanvas.canvas;
    this.tempCtx = tempCanvas.ctx;

    // 도구 모음 생성
    this.createToolbar();

    // DOM에 추가
    this.overlay.appendChild(this.canvas);
    this.overlay.appendChild(this.tempCanvas);
    document.body.appendChild(this.overlay);

    // 윈도우 리사이즈 이벤트 등록
    this.setupResizeHandler();
  }

  setupResizeHandler() {
    // 리사이즈 이벤트 디바운싱으로 성능 개선
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.resizeCanvases();
      }, 150);
    });
  }

  createToolbar() {
    // 메인 도구모음 컨테이너
    this.toolbarContainer = document.createElement('div');
    this.toolbarContainer.id = 'sketch-toolbar-container';

    // 실제 도구모음
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'sketch-toolbar';

    // 토글 버튼 생성 및 추가
    this.createToggleButton();

    // 도구 버튼들 생성 및 추가
    this.createToolButtons();

    this.toolbarContainer.appendChild(this.toolbar);
    this.overlay.appendChild(this.toolbarContainer);
  }

  createToggleButton() {
    this.toggleButton = document.createElement('button');
    this.toggleButton.id = 'sketch-toggle-btn';
    this.toggleButton.innerHTML = '◀';
    this.toggleButton.title = chrome.i18n.getMessage('toolbar_collapse');

    this.toggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleToolbar();
    });

    this.toolbar.appendChild(this.toggleButton);
  }

  createToolButtons() {
    this.TOOLS.forEach(tool => {
      const button = this.createToolButton(tool);
      this.toolbar.appendChild(button);
    });
  }

  createToolButton(tool) {
    const button = document.createElement('button');
    const isActive = this.currentTool === tool.name;
    const isActionButton = tool.name === 'close' || tool.name === 'settings';

    button.innerHTML = tool.icon;
    button.title = chrome.i18n.getMessage(tool.titleKey);
    button.dataset.toolName = tool.name;

    // CSS 클래스 적용
    if (isActive) {
      button.classList.add('active');
    } else if (isActionButton) {
      button.classList.add('action-button');
    }

    // 이벤트 리스너 추가
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleToolButtonClick(tool.name);
    });

    return button;
  }

  handleToolButtonClick(toolName) {
    if (toolName === 'close') {
      this.toggleDrawingMode();
    } else if (toolName === 'settings') {
      this.openSettingsPage();
    } else {
      this.currentTool = toolName;
      this.updateToolbarButtons();
    }
  }

  updateToolbarButtons() {
    if (!this.toolbar) return;

    // 토글 버튼 제외하고 도구 버튼들만 선택
    const buttons = this.toolbar.querySelectorAll('button:not(#sketch-toggle-btn)');
    buttons.forEach((button) => {
      const toolName = button.dataset.toolName;
      if (!toolName) return; // toolName이 없으면 건너뛰기

      const isActive = toolName === this.currentTool;
      const isActionButton = toolName === 'close' || toolName === 'settings';

      // 기존 클래스들 명시적으로 제거
      button.classList.remove('active', 'action-button');

      // 적절한 클래스 추가
      if (isActive) {
        button.classList.add('active');
      } else if (isActionButton) {
        button.classList.add('action-button');
      }
    });
  }

  toggleToolbar() {
    this.toolbarCollapsed = !this.toolbarCollapsed;

    if (this.toolbarCollapsed) {
      this.toolbar.classList.add('collapsed');
      this.toggleButton.innerHTML = '▶';
      this.toggleButton.title = chrome.i18n.getMessage('toolbar_expand');
    } else {
      this.toolbar.classList.remove('collapsed');
      this.toggleButton.innerHTML = '◀';
      this.toggleButton.title = chrome.i18n.getMessage('toolbar_collapse');
    }
  }

  setupEventListeners() {
    // 마우스 이벤트
    this.overlay.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.overlay.addEventListener('mousemove', (e) => this.draw(e));
    this.overlay.addEventListener('mouseup', (e) => this.stopDrawing(e));
  }

  setupKeyboardShortcuts() {
    // 크롬 확장프로그램 commands API 사용
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.command === 'toggle_drawing_mode') {
        this.toggleDrawingMode();
      } else if (request.command === 'mask_selected_text') {
        this.maskSelectedText();
      } else if (request.command === 'toggle_area_masking') {
        this.toggleAreaMaskingMode();
      } else if (request.command === 'get_status') {
        // 현재 상태 정보 반환
        sendResponse({
          status: 'success',
          data: {
            isDrawingMode: this.isDrawingMode,
            isAreaMaskingMode: this.isAreaMaskingMode,
            currentTool: this.currentTool,
            currentMode: this.getCurrentMode(),
            settings: this.settings
          }
        });
        return true; // 비동기 응답을 위해 true 반환
      }
      sendResponse({ status: 'success' });
    });
  }

  // 유틸리티 함수들: 모드 상태 관리
  getCurrentMode() {
    if (this.isDrawingMode) return 'drawing';
    if (this.isAreaMaskingMode) return 'area_masking';
    return 'normal';
  }

  isAnyModeActive() {
    return this.isDrawingMode || this.isAreaMaskingMode;
  }

  deactivateAllModes() {
    if (this.isDrawingMode) {
      this.deactivateDrawingMode();
      this.isDrawingMode = false;
    }
    if (this.isAreaMaskingMode) {
      this.deactivateAreaMaskingMode();
      this.isAreaMaskingMode = false;
    }
  }

  toggleDrawingMode() {
    if (this.isDrawingMode) {
      // 그리기 모드 비활성화
      this.deactivateDrawingMode();
      this.isDrawingMode = false;
    } else {
      // 다른 모드들과 충돌 방지 - 영역 마스킹 모드 비활성화
      if (this.isAreaMaskingMode) {
        this.deactivateAreaMaskingMode();
        this.isAreaMaskingMode = false;
      }

      // 그리기 모드 활성화
      this.activateDrawingMode();
      this.isDrawingMode = true;
    }
  }

  activateDrawingMode() {
    // 필요 시 오버레이 생성
    this.ensureOverlay();

    // 오버레이가 DOM에 있는지 확인
    if (!document.body.contains(this.overlay)) {
      document.body.appendChild(this.overlay);
    }

    // 오버레이 활성화
    this.overlay.style.display = 'block';
    this.overlay.style.pointerEvents = 'all';
    this.overlay.style.zIndex = this.CONSTANTS.Z_INDEX_OVERLAY;
    this.overlay.style.cursor = 'default';

    // 그리기 모드 전용 스타일 적용
    document.body.style.userSelect = 'none';
    document.body.classList.add('sketch-drawing-mode');

    // 도구모음 표시
    if (this.toolbarContainer) {
      this.toolbarContainer.style.display = 'block';
    }

    // DOM 렌더링 완료 후 설정
    requestAnimationFrame(() => {
      this.resizeCanvases();

      // 크기가 0이면 강제로 다시 설정
      if (this.overlay.offsetWidth === 0 || this.overlay.offsetHeight === 0) {
        this.forceOverlaySize();
      }

      // 기본 도구 설정 및 활성화 표시
      this.currentTool = this.CONSTANTS.DEFAULT_TOOL;
      this.updateToolbarButtons();

      // 설정에 따라 도구바 초기 접힘 상태 적용
      if (this.settings.drawing.toolbarCollapsed) {
        this.toolbar.classList.add('collapsed');
        this.toggleButton.innerHTML = '▶';
        this.toggleButton.title = chrome.i18n.getMessage('toolbar_expand');
      } else {
        this.toolbar.classList.remove('collapsed');
        this.toggleButton.innerHTML = '◀';
        this.toggleButton.title = chrome.i18n.getMessage('toolbar_collapse');
      }
    });

    this.showNotification(chrome.i18n.getMessage('notify_drawing_mode_on'), 'success');
  }

  deactivateDrawingMode() {
    // 오버레이 비활성화
    this.overlay.style.display = 'none';
    this.overlay.style.pointerEvents = 'none';
    this.overlay.style.cursor = 'default';

    // 페이지 스타일 복구
    document.body.style.userSelect = 'auto';
    document.body.classList.remove('sketch-drawing-mode');

    // 그리기 내용 초기화
    this.clearCanvas();

    // 마스킹된 텍스트가 있으면 모두 해제
    if (this.maskedElements.length > 0) {
      this.unmaskAllText();
    }

    this.showNotification(chrome.i18n.getMessage('notify_drawing_mode_off'), 'info');
  }

  /**
   * 설정 페이지 열기
   */
  openSettingsPage() {
    // Chrome extension의 옵션 페이지 열기
    chrome.runtime.sendMessage({ command: 'open_options' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('설정 페이지 열기 실패:', chrome.runtime.lastError.message);
        this.showNotification(chrome.i18n.getMessage('notify_settings_error'), 'error');
      } else {
        this.showNotification(chrome.i18n.getMessage('notify_settings_opened'), 'success');
      }
    });
  }

  startDrawing(e) {
    // 도구모음 클릭 시 무시
    if (e.target.closest('#sketch-toolbar-container')) return;

    // 그리기 모드인 경우
    if (this.isDrawingMode) {
      this.isDrawing = true;
      this.startX = e.clientX;
      this.startY = e.clientY;

      // 캔버스 컨텍스트 설정
      this.setupCanvasContext(this.ctx);

      if (this.currentTool === 'pen') {
        this.ctx.beginPath();
        this.ctx.moveTo(this.startX, this.startY);
      }
      return;
    }

    // 영역 마스킹 모드인 경우
    if (this.isAreaMaskingMode) {
      this.isDrawing = true;
      this.startX = e.clientX;
      this.startY = e.clientY;

      // 임시 캔버스 컨텍스트 설정
      this.setupCanvasContext(this.tempCtx);
      return;
    }
  }

  draw(e) {
    if (!this.isDrawing) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    // 그리기 모드인 경우
    if (this.isDrawingMode) {
      // 임시 캔버스 초기화 및 설정
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
      this.setupCanvasContext(this.tempCtx);

      // 도구별 그리기 처리
      this.drawWithTool(currentX, currentY);
      return;
    }

    // 영역 마스킹 모드인 경우 - 항상 사각형
    if (this.isAreaMaskingMode) {
      // 임시 캔버스 초기화 및 설정
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
      this.setupCanvasContext(this.tempCtx);

      // 사각형 그리기
      this.tempCtx.strokeRect(
        this.startX,
        this.startY,
        currentX - this.startX,
        currentY - this.startY
      );
      return;
    }
  }

  drawWithTool(currentX, currentY) {
    switch (this.currentTool) {
      case 'pen':
        this.drawPen(currentX, currentY);
        break;
      case 'rectangle':
        this.drawRectangle(currentX, currentY);
        break;
      case 'circle':
        this.drawCircle(currentX, currentY);
        break;
      case 'line':
        this.drawLine(currentX, currentY);
        break;
    }
  }

  drawPen(currentX, currentY) {
    this.ctx.lineTo(currentX, currentY);
    this.ctx.stroke();
  }

  drawRectangle(currentX, currentY) {
    this.tempCtx.strokeRect(
      this.startX,
      this.startY,
      currentX - this.startX,
      currentY - this.startY
    );
  }

  drawCircle(currentX, currentY) {
    const centerX = (this.startX + currentX) / 2;
    const centerY = (this.startY + currentY) / 2;
    const radius = Math.sqrt(
      Math.pow(currentX - this.startX, 2) + Math.pow(currentY - this.startY, 2)
    ) / 2;
    this.tempCtx.beginPath();
    this.tempCtx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    this.tempCtx.stroke();
  }

  drawLine(currentX, currentY) {
    this.tempCtx.beginPath();
    this.tempCtx.moveTo(this.startX, this.startY);
    this.tempCtx.lineTo(currentX, currentY);
    this.tempCtx.stroke();
  }

  stopDrawing(e) {
    if (!this.isDrawing) return;

    this.isDrawing = false;
    const currentX = e.clientX;
    const currentY = e.clientY;

    // 그리기 모드인 경우
    if (this.isDrawingMode) {
      // 임시 캔버스의 내용을 메인 캔버스로 복사 (펜 도구 제외)
      if (this.currentTool !== 'pen') {
        this.ctx.drawImage(this.tempCanvas, 0, 0);
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
      }

      // 실행 취소를 위한 상태 저장
      this.saveCanvasState();
      return;
    }

    // 영역 마스킹 모드인 경우
    if (this.isAreaMaskingMode) {
      const width = currentX - this.startX;
      const height = currentY - this.startY;

      // 임시 캔버스 초기화
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);

      // 영역 마스킹 생성
      this.createAreaMask(this.startX, this.startY, width, height);
      return;
    }
  }

  saveCanvasState() {
    this.paths.push({
      imageData: this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
    });
  }


  clearCanvas() {
    if (this.ctx && this.tempCtx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    }
    this.paths = [];
  }

  resizeCanvases() {
    const dimensions = this.getScreenDimensions();

    // 오버레이 크기 업데이트
    this.overlay.style.width = dimensions.width + 'px';
    this.overlay.style.height = dimensions.height + 'px';

    // 캔버스들 크기 업데이트
    this.updateCanvasSize(this.canvas, this.ctx, dimensions);
    this.updateCanvasSize(this.tempCanvas, this.tempCtx, dimensions);

    // 기존 그림 복원
    this.redrawAll();
  }

  forceOverlaySize() {
    const dimensions = this.getScreenDimensions();

    // 오버레이 강제 크기 설정
    this.overlay.style.setProperty('width', dimensions.width + 'px', 'important');
    this.overlay.style.setProperty('height', dimensions.height + 'px', 'important');
    this.overlay.style.setProperty('display', 'block', 'important');
    this.overlay.style.setProperty('pointer-events', 'all', 'important');

    // 캔버스들 강제 크기 설정
    this.canvas.style.setProperty('width', dimensions.width + 'px', 'important');
    this.canvas.style.setProperty('height', dimensions.height + 'px', 'important');
    this.tempCanvas.style.setProperty('width', dimensions.width + 'px', 'important');
    this.tempCanvas.style.setProperty('height', dimensions.height + 'px', 'important');
  }

  redrawAll() {
    // 윈도우 리사이즈 시 다시 그리기
    if (this.paths && this.paths.length > 0) {
      // 이전 그림들을 다시 그리기
      this.paths.forEach(path => {
        if (path.imageData) {
          this.ctx.putImageData(path.imageData, 0, 0);
        }
      });
    }
  }

  maskSelectedText() {
    // 텍스트 마스킹은 다른 모드와 독립적으로 동작
    const selection = window.getSelection();

    // 선택된 텍스트가 있는 경우 - 마스킹 수행
    if (selection.rangeCount > 0 && selection.toString().trim()) {
      const range = selection.getRangeAt(0);
      const selectedText = range.toString();

      // 각 문자를 설정된 마스킹 문자로 교체하되, 공백은 유지
      const maskedText = selectedText.replace(/\S/g, this.settings.textMasking.maskingChar);

      try {
        // 선택된 텍스트를 마스킹된 텍스트로 교체
        const maskedNode = document.createTextNode(maskedText);
        range.deleteContents();
        range.insertNode(maskedNode);

        // 마스킹된 요소 정보 저장
        this.maskedElements.push({
          node: maskedNode,
          originalText: selectedText,
          parentNode: maskedNode.parentNode
        });

        // 선택 해제
        selection.removeAllRanges();

        this.showNotification(chrome.i18n.getMessage('notify_text_masking_done'), 'success');
        return true;
      } catch (error) {
        this.showNotification(chrome.i18n.getMessage('notify_text_masking_error'), 'error');
        return false;
      }
    } else {
      // 선택된 텍스트가 없는 경우 - 기존 마스킹 해제
      if (this.maskedElements.length > 0) {
        this.unmaskAllText();
        return true;
      } else {
        this.showNotification(chrome.i18n.getMessage('notify_text_masking_select'), 'error');
        return false;
      }
    }
  }

  unmaskAllText() {
    let unmaskedCount = 0;

    // 마스킹된 모든 요소를 원래 텍스트로 복구
    this.maskedElements.forEach(maskedElement => {
      try {
        if (maskedElement.node && maskedElement.node.parentNode && maskedElement.originalText) {
          // 마스킹된 노드를 원래 텍스트로 교체
          const originalNode = document.createTextNode(maskedElement.originalText);
          maskedElement.node.parentNode.replaceChild(originalNode, maskedElement.node);
          unmaskedCount++;
        }
      } catch (error) {
        console.warn('마스킹 해제 중 오류:', error);
      }
    });

    // 마스킹된 요소들 배열 초기화
    this.maskedElements = [];

    if (unmaskedCount > 0) {
      this.showNotification(chrome.i18n.getMessage('notify_text_masking_unmasked', unmaskedCount.toString()), 'success');
    }

    return unmaskedCount;
  }

  toggleAreaMaskingMode() {
    if (this.isAreaMaskingMode) {
      // 영역 마스킹 모드 비활성화
      this.deactivateAreaMaskingMode();
      this.isAreaMaskingMode = false;
    } else {
      // 다른 모드들과 충돌 방지 - 그리기 모드 비활성화
      if (this.isDrawingMode) {
        this.deactivateDrawingMode();
        this.isDrawingMode = false;
      }

      // 영역 마스킹 모드 활성화
      this.activateAreaMaskingMode();
      this.isAreaMaskingMode = true;
    }
  }

  activateAreaMaskingMode() {
    // 필요 시 오버레이 생성
    this.ensureOverlay();

    // 오버레이가 DOM에 있는지 확인
    if (!document.body.contains(this.overlay)) {
      document.body.appendChild(this.overlay);
    }

    // 오버레이 설정 (영역 마스킹 전용)
    this.overlay.style.display = 'block';
    this.overlay.style.pointerEvents = 'all';
    this.overlay.style.zIndex = this.CONSTANTS.Z_INDEX_OVERLAY;
    this.overlay.style.cursor = 'crosshair';

    // 영역 마스킹 모드 전용 스타일 적용
    document.body.style.userSelect = 'none';
    document.body.classList.add('sketch-area-masking-mode');

    // 영역 마스킹 모드에서는 도구모음 숨기기
    if (this.toolbarContainer) {
      this.toolbarContainer.style.display = 'none';
    }

    // DOM 렌더링 완료 후 크기 재설정
    requestAnimationFrame(() => {
      this.resizeCanvases();

      // 크기가 0이면 강제로 다시 설정
      if (this.overlay.offsetWidth === 0 || this.overlay.offsetHeight === 0) {
        this.forceOverlaySize();
      }
    });

    this.showNotification(chrome.i18n.getMessage('notify_area_masking_on'), 'success');
  }

  deactivateAreaMaskingMode() {
    // 오버레이 비활성화
    this.overlay.style.display = 'none';
    this.overlay.style.pointerEvents = 'none';
    this.overlay.style.cursor = 'default';

    // 페이지 스타일 복구
    document.body.style.userSelect = 'auto';
    document.body.classList.remove('sketch-area-masking-mode');

    // 도구모음 다시 보이기 (필요한 경우에만)
    if (this.toolbarContainer && !this.isDrawingMode) {
      this.toolbarContainer.style.display = 'block';
    }

    // 캔버스 초기화
    this.clearCanvas();

    // 영역 마스킹이 있으면 모두 해제
    if (this.areaMasks.length > 0) {
      this.clearAllAreaMasks();
    }

    this.showNotification(chrome.i18n.getMessage('notify_area_masking_off'), 'info');
  }

  createAreaMask(x, y, width, height) {
    // 절대값으로 변환하여 음수 너비/높이 처리
    const normalizedX = Math.min(x, x + width);
    const normalizedY = Math.min(y, y + height);
    const normalizedWidth = Math.abs(width);
    const normalizedHeight = Math.abs(height);

    // 너무 작은 영역은 무시
    if (normalizedWidth < 10 || normalizedHeight < 10) {
      this.showNotification(chrome.i18n.getMessage('notify_area_too_small'), 'error');
      return;
    }

    // 마스킹 오버레이 div 생성
    const maskOverlay = document.createElement('div');
    maskOverlay.className = 'sketch-area-mask';
    maskOverlay.style.cssText = `
      position: fixed;
      left: ${normalizedX}px;
      top: ${normalizedY}px;
      width: ${normalizedWidth}px;
      height: ${normalizedHeight}px;
      background-color: rgba(128, 128, 128, 0);
      backdrop-filter: blur(${this.settings.areaBlur.blurIntensity}px);
      -webkit-backdrop-filter: blur(${this.settings.areaBlur.blurIntensity}px);
      border: none;
      box-sizing: border-box;
      pointer-events: none;
      z-index: ${this.CONSTANTS.Z_INDEX_OVERLAY - 1};
    `;

    document.body.appendChild(maskOverlay);

    // 마스킹 정보 저장
    this.areaMasks.push({
      element: maskOverlay,
      x: normalizedX,
      y: normalizedY,
      width: normalizedWidth,
      height: normalizedHeight
    });

    this.showNotification(chrome.i18n.getMessage('notify_area_masked', this.areaMasks.length.toString()), 'success');
  }

  clearAllAreaMasks() {
    this.areaMasks.forEach(mask => {
      if (mask.element && mask.element.parentNode) {
        mask.element.parentNode.removeChild(mask.element);
      }
    });
    this.areaMasks = [];
  }

  showNotification(message, type = 'info') {
    // 기존 알림이 있으면 제거
    const existingNotification = document.getElementById('sketch-notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    // 알림 요소 생성
    const notification = document.createElement('div');
    notification.id = 'sketch-notification';
    notification.className = type;
    notification.textContent = message;

    document.body.appendChild(notification);

    // 애니메이션으로 표시
    requestAnimationFrame(() => {
      notification.classList.add('show');
    });

    // 설정된 시간 후 자동 제거
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.remove();
        }
      }, 100);
    }, this.CONSTANTS.NOTIFICATION_DURATION);
  }
}

// SketchMasking 초기화
if (!window.sketchMaskingInitialized) {
  window.sketchMaskingInitialized = true;

  const initializeSketchMasking = () => {
    if (!window.sketchMaskingInstance) {
      try {
        window.sketchMaskingInstance = new SketchMasking();

        // 전역 함수로도 접근 가능하게 설정
        window.toggleDrawingMode = () => window.sketchMaskingInstance?.toggleDrawingMode();
        window.maskSelectedText = () => window.sketchMaskingInstance?.maskSelectedText();
        window.toggleAreaMaskingMode = () => window.sketchMaskingInstance?.toggleAreaMaskingMode();
      } catch (error) {
        console.error('SketchMasking 초기화 오류:', error);
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSketchMasking);
  } else {
    initializeSketchMasking();
  }

  // 초기화 재시도
  setTimeout(() => {
    if (!window.sketchMaskingInstance) {
      initializeSketchMasking();
    }
  }, 1000);
}
