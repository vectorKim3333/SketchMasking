class SketchMasking {
  constructor() {
    // 기본 설정값 (settings로부터 오버라이드됨)
    this.settings = {
      drawing: {
        lineColor: '#FF0000',
        lineWidth: 2,
        toolbarCollapsed: false,
        textFontSize: 16
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
      { name: 'text', icon: 'T', titleKey: 'tool_text' },
      { name: 'line', icon: '/', titleKey: 'tool_line' },
      { name: 'arrow', icon: '➤', titleKey: 'tool_arrow' },
      { name: 'settings', icon: '⚙️', titleKey: 'tool_settings' },
      { name: 'close', icon: '✕', titleKey: 'tool_close' }
    ];

    // 상태 변수들
    this.isDrawingMode = false;
    this.isAreaMaskingMode = false;
    // 둘 다 활성화될 수 있으므로 현재 활성 모드를 별도로 추적
    this.activeMode = 'normal'; // 'normal' | 'drawing' | 'area_masking'
    this.currentTool = this.CONSTANTS.DEFAULT_TOOL;
    this.isDrawing = false;

    // 좌표
    this.startX = 0;
    this.startY = 0;
    this.isTextEditing = false;
    this.textInputEl = null;
    this.textRect = null; // { x, y, w, h }

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

    // 히스토리 스택 (Undo/Redo)
    // 개별 모드 스택은 더 이상 사용하지 않고, 전역 히스토리를 사용
    this.history = {
      drawingUndo: [],
      drawingRedo: [],
      areaUndo: [],
      areaRedo: []
    };
    this.globalHistory = { undo: [], redo: [] };
    this._preDrawImage = null; // 드로잉 작업 전 캔버스 스냅샷
    this._areaPreSnapshot = null; // 영역 마스킹 작업 전 스냅샷

    this.init();
  }

  async init() {
    // 설정 로드
    await this.loadSettings();

    // 메시지/단축키 리스너와 설정 변경 리스너만 초기화
    // 오버레이는 사용자 동작(팝업/단축키)으로 모드 활성화 시 생성
    this.setupKeyboardShortcuts();
    this.setupSettingsListener();
    this.setupLocalKeyShortcuts();
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

    // 도구바 접힘 상태 적용 (현재 활성 모드가 그리기일 때만)
    if (this.toolbar && this.activeMode === 'drawing') {
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

  // 로컬 키 이벤트 (Ctrl/Cmd + Z/Y)
  setupLocalKeyShortcuts() {
    this._onKeyDownBound = (e) => this.handleKeyDown(e);
    document.addEventListener('keydown', this._onKeyDownBound, true);
  }

  handleKeyDown(e) {
    // 텍스트 입력 중에는 페이지 기본 동작 유지
    if (this.isTextEditing) return;

    const isCtrl = e.ctrlKey || e.metaKey;
    if (!isCtrl) return;

    const key = (e.key || '').toLowerCase();

    // Undo / Redo
    if (key === 'z' && !e.shiftKey) {
      const handled = this.undo();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      const handled = this.redo();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  undo() {
    return this.doGlobalUndo();
  }

  redo() {
    return this.doGlobalRedo();
  }

  pushHistoryEntry(kind, before, after) {
    try {
      this.globalHistory.undo.push({ kind, before, after });
      this.globalHistory.redo = [];
    } catch (_) {
      // ignore
    }
  }

  doGlobalUndo() {
    if (!this.globalHistory || this.globalHistory.undo.length === 0) return false;
    const entry = this.globalHistory.undo.pop();
    this.globalHistory.redo.push(entry);
    if (entry.kind === 'drawing') {
      if (!this.ctx || !entry.before) return false;
      try {
        this.ctx.putImageData(entry.before, 0, 0);
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
        this.saveCanvasState();
        return true;
      } catch (_) { return false; }
    } else if (entry.kind === 'area') {
      try {
        this.applyAreaSnapshot(entry.before || []);
        return true;
      } catch (_) { return false; }
    }
    return false;
  }

  doGlobalRedo() {
    if (!this.globalHistory || this.globalHistory.redo.length === 0) return false;
    const entry = this.globalHistory.redo.pop();
    this.globalHistory.undo.push(entry);
    if (entry.kind === 'drawing') {
      if (!this.ctx || !entry.after) return false;
      try {
        this.ctx.putImageData(entry.after, 0, 0);
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
        this.saveCanvasState();
        return true;
      } catch (_) { return false; }
    } else if (entry.kind === 'area') {
      try {
        this.applyAreaSnapshot(entry.after || []);
        return true;
      } catch (_) { return false; }
    }
    return false;
  }

  doDrawingUndo() {
    if (!this.ctx || this.history.drawingUndo.length === 0) return false;
    try {
      const current = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      this.history.drawingRedo.push(current);
      const prev = this.history.drawingUndo.pop();
      this.ctx.putImageData(prev, 0, 0);
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
      this.saveCanvasState();
      return true;
    } catch (_) {
      return false;
    }
  }

  doDrawingRedo() {
    if (!this.ctx || this.history.drawingRedo.length === 0) return false;
    try {
      const current = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      this.history.drawingUndo.push(current);
      const next = this.history.drawingRedo.pop();
      this.ctx.putImageData(next, 0, 0);
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
      this.saveCanvasState();
      return true;
    } catch (_) {
      return false;
    }
  }

  getAreaSnapshot() {
    return this.areaMasks.map(m => ({
      x: m.x, y: m.y, width: m.width, height: m.height, blurIntensity: m.blurIntensity || this.settings.areaBlur.blurIntensity
    }));
  }

  applyAreaSnapshot(snapshot) {
    // 기존 마스크 제거
    this.clearAllAreaMasks();
    // 스냅샷으로 복원
    snapshot.forEach(s => {
      const maskOverlay = document.createElement('div');
      maskOverlay.className = 'sketch-area-mask';
      maskOverlay.style.cssText = `
        position: fixed;
        left: ${s.x}px;
        top: ${s.y}px;
        width: ${s.width}px;
        height: ${s.height}px;
        background-color: rgba(128, 128, 128, 0);
        backdrop-filter: blur(${s.blurIntensity}px);
        -webkit-backdrop-filter: blur(${s.blurIntensity}px);
        border: none;
        box-sizing: border-box;
        pointer-events: none;
        z-index: ${this.CONSTANTS.Z_INDEX_OVERLAY - 1};
      `;
      document.body.appendChild(maskOverlay);
      this.areaMasks.push({ element: maskOverlay, x: s.x, y: s.y, width: s.width, height: s.height, blurIntensity: s.blurIntensity });
    });
  }

  doAreaUndo() {
    if (this.history.areaUndo.length === 0) return false;
    const current = this.getAreaSnapshot();
    this.history.areaRedo.push(current);
    const prev = this.history.areaUndo.pop();
    this.applyAreaSnapshot(prev);
    return true;
  }

  doAreaRedo() {
    if (this.history.areaRedo.length === 0) return false;
    const current = this.getAreaSnapshot();
    this.history.areaUndo.push(current);
    const next = this.history.areaRedo.pop();
    this.applyAreaSnapshot(next);
    return true;
  }

  // 유틸리티 함수들: 모드 상태 관리
  getCurrentMode() {
    return this.activeMode;
  }

  isAnyModeActive() {
    return this.isDrawingMode || this.isAreaMaskingMode;
  }

  deactivateAllModes() {
    // 전체 초기화 로직으로 교체 (두 모드 모두 종료)
    const wasDrawingActive = this.isDrawingMode;
    this.deactivateVisuals();
    if (wasDrawingActive && this.maskedElements.length > 0) {
      // 기존 동작 유지: 그리기 모드 종료 시 텍스트 마스킹 해제
      this.unmaskAllText();
    }
    this.isDrawingMode = false;
    this.isAreaMaskingMode = false;
    this.activeMode = 'normal';
  }

  // 현재 활성 모드를 설정하고 UI 반영
  setActiveMode(mode) {
    this.activeMode = mode; // 'drawing' | 'area_masking'
    if (!this.overlay) return;

    if (mode === 'drawing') {
      document.body.classList.add('sketch-drawing-mode');
      document.body.classList.remove('sketch-area-masking-mode');
      this.overlay.style.cursor = 'default';
      if (this.toolbarContainer) this.toolbarContainer.style.display = 'block';
    } else if (mode === 'area_masking') {
      document.body.classList.add('sketch-area-masking-mode');
      document.body.classList.remove('sketch-drawing-mode');
      this.overlay.style.cursor = 'crosshair';
      if (this.toolbarContainer) this.toolbarContainer.style.display = 'none';
    }
  }

  toggleDrawingMode() {
    if (this.isDrawingMode && this.activeMode === 'drawing') {
      // 현재 활성 모드를 다시 실행 → 전체 초기화
      this.deactivateDrawingMode();
      this.isDrawingMode = false;
      this.isAreaMaskingMode = false;
      this.activeMode = 'normal';
    } else {
      // 그리기 모드 활성화 (다른 모드는 유지)
      this.isDrawingMode = true;
      this.activateDrawingMode();
      this.setActiveMode('drawing');
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
    document.body.classList.remove('sketch-area-masking-mode');

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
    // 전체 시각 요소 초기화 + 텍스트 마스킹 복구(기존 동작 유지)
    this.deactivateVisuals();
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
    // 텍스트 입력 중에는 드로잉 비활성
    if (this.isTextEditing) return;
    // 도구모음 클릭 시 무시
    if (e.target.closest('#sketch-toolbar-container')) return;
    // 텍스트 입력창 상호작용 시 무시
    if (e.target.classList && e.target.classList.contains('sketch-text-input')) return;

    // 활성 모드 기준 처리
    if (this.activeMode === 'drawing') {
      // 드로잉 전 상태 스냅샷 확보 (Undo용)
      try {
        this._preDrawImage = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      } catch (_) { this._preDrawImage = null; }
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
    if (this.activeMode === 'area_masking') {
      this.isDrawing = true;
      this.startX = e.clientX;
      this.startY = e.clientY;

      // 임시 캔버스 컨텍스트 설정
      this.setupCanvasContext(this.tempCtx);
      return;
    }
  }

  draw(e) {
    if (!this.isDrawing || this.isTextEditing) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    // 그리기 모드인 경우
    if (this.activeMode === 'drawing') {
      // 임시 캔버스 초기화 및 설정
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
      this.setupCanvasContext(this.tempCtx);

      // 도구별 그리기 처리
      this.drawWithTool(currentX, currentY);
      return;
    }

    // 영역 마스킹 모드인 경우 - 항상 사각형
    if (this.activeMode === 'area_masking') {
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
      case 'arrow':
        this.drawArrow(currentX, currentY);
        break;
      case 'text':
        // 텍스트는 드래그 영역을 가이드로 보여줌
        this.drawRectangle(currentX, currentY);
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

  drawArrow(currentX, currentY) {
    const ctx = this.tempCtx;
    const startX = this.startX;
    const startY = this.startY;
    const endX = currentX;
    const endY = currentY;

    // 선
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // 화살표 머리
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx);
    const baseSize = 10;
    const headLen = Math.max(baseSize, this.settings.drawing.lineWidth * 4);
    const headAngle = Math.PI / 6; // 30도

    const x1 = endX - headLen * Math.cos(angle - headAngle);
    const y1 = endY - headLen * Math.sin(angle - headAngle);
    const x2 = endX - headLen * Math.cos(angle + headAngle);
    const y2 = endY - headLen * Math.sin(angle + headAngle);

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();

    // 채우기 및 외곽선 색상 설정
    const color = this.settings.drawing.lineColor;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();
  }

  createTextInputAtRect(x, y, w, h) {
    // 너무 작은 영역은 무시
    const minSize = 10;
    if (w < minSize || h < minSize) return;

    this.isTextEditing = true;
    this.textRect = { x, y, w, h };

    // 텍스트 입력 전 캔버스 상태 저장 (Undo용)
    try {
      this._preDrawImage = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    } catch (_) { this._preDrawImage = null; }

    // 기존 입력창 제거
    if (this.textInputEl && this.textInputEl.parentNode) {
      this.textInputEl.parentNode.removeChild(this.textInputEl);
    }

    const ta = document.createElement('textarea');
    ta.className = 'sketch-text-input';
    ta.style.position = 'fixed';
    ta.style.left = x + 'px';
    ta.style.top = y + 'px';
    ta.style.width = Math.max(30, w) + 'px';
    ta.style.height = Math.max(24, h) + 'px';
    ta.style.padding = '4px 6px';
    ta.style.boxSizing = 'border-box';
    ta.style.border = '1px dashed ' + this.settings.drawing.lineColor;
    ta.style.background = 'rgba(0,0,0,0.05)';
    ta.style.color = this.settings.drawing.lineColor;
    ta.style.font = `${this.settings.drawing.textFontSize || 16}px system-ui, -apple-system, sans-serif`;
    ta.style.lineHeight = '1.3';
    ta.style.resize = 'both';
    ta.style.zIndex = (this.CONSTANTS.Z_INDEX_OVERLAY + 1).toString();
    ta.style.pointerEvents = 'auto';
    ta.style.outline = 'none';
    ta.placeholder = '';

    // 내부 이벤트 전파 방지
    ['mousedown','mouseup','mousemove','click','dblclick'].forEach(evt => {
      ta.addEventListener(evt, (ev) => ev.stopPropagation());
    });

    // 키 이벤트: Enter/Meta+Enter/Ctrl+Enter 확정, Esc 취소
    ta.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) ) {
        ev.preventDefault();
        this.commitTextInput();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.cancelTextInput();
      }
    });

    // 포커스 아웃 시 자동 확정
    ta.addEventListener('blur', () => {
      // setTimeout으로 클릭 이동 등과 충돌 방지
      setTimeout(() => {
        if (this.isTextEditing) {
          this.commitTextInput();
        }
      }, 0);
    });

    this.overlay.appendChild(ta);
    this.textInputEl = ta;
    ta.focus();
  }

  commitTextInput() {
    const ta = this.textInputEl;
    if (!ta || !this.textRect) {
      this.isTextEditing = false;
      return;
    }

    const text = ta.value;
    // 입력 내용이 없으면 취소로 처리
    if (!text || !text.trim()) {
      this.cancelTextInput();
      return;
    }

    const { x, y } = this.textRect;
    // 실제 크기는 사용자가 리사이즈했을 수 있으므로 DOM에서 가져옴
    const w = Math.max(10, parseInt(ta.style.width, 10));
    const h = Math.max(10, parseInt(ta.style.height, 10));

    const fontSize = this.settings.drawing.textFontSize || 16;
    const color = this.settings.drawing.lineColor;

    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const lineHeight = Math.round(fontSize * 1.3);
    this.fillWrappedText(ctx, text, x + 4, y + 4, w - 8, h - 8, lineHeight);

    ctx.restore();

    // 전역 히스토리에 (before/after) 저장
    if (this._preDrawImage) {
      try {
        const afterImg = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.pushHistoryEntry('drawing', this._preDrawImage, afterImg);
      } catch (_) { /* ignore */ }
      this._preDrawImage = null;
    }

    // 상태 저장 및 청소 (리사이즈 복원용)
    this.saveCanvasState();
    this.removeTextInput();
  }

  cancelTextInput() {
    this.removeTextInput();
  }

  removeTextInput() {
    if (this.textInputEl && this.textInputEl.parentNode) {
      this.textInputEl.parentNode.removeChild(this.textInputEl);
    }
    this.textInputEl = null;
    this.textRect = null;
    this.isTextEditing = false;
  }

  fillWrappedText(ctx, text, x, y, maxWidth, maxHeight, lineHeight) {
    // 단락 기준으로 나눈 뒤 각 단락을 줄바꿈 처리
    const paragraphs = text.split(/\r?\n/);
    let cursorY = y;

    for (const para of paragraphs) {
      const lines = this.wrapLine(ctx, para, maxWidth);
      for (const line of lines) {
        if ((cursorY + lineHeight) > (y + maxHeight)) {
          return; // 영역 넘어가면 중단
        }
        ctx.fillText(line, x, cursorY);
        cursorY += lineHeight;
      }
      // 단락 간 여백
      cursorY += Math.round(lineHeight * 0.2);
      if ((cursorY + lineHeight) > (y + maxHeight)) {
        return;
      }
    }
  }

  wrapLine(ctx, text, maxWidth) {
    // 공백 단위로 기본 래핑, 공백이 거의 없으면 문자 단위로 폴백
    const words = text.trim().length ? text.split(/(\s+)/).filter(Boolean) : [];
    const useChar = words.length <= 1; // 단어가 거의 없으면 문자 단위

    if (useChar) {
      const chars = Array.from(text);
      const lines = [];
      let current = '';
      for (const ch of chars) {
        const test = current + ch;
        if (ctx.measureText(test).width > maxWidth && current) {
          lines.push(current);
          current = ch;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
      return lines;
    } else {
      const lines = [];
      let current = '';
      for (const token of words) {
        const test = current + token;
        if (ctx.measureText(test).width > maxWidth && current) {
          lines.push(current.trimEnd());
          // 공백으로 시작하지 않도록 트림 후 새 줄 시작
          current = token.trimStart();
        } else {
          current = test;
        }
      }
      if (current) lines.push(current.trimEnd());
      return lines;
    }
  }

  stopDrawing(e) {
    if (!this.isDrawing) return;

    this.isDrawing = false;
    const currentX = e.clientX;
    const currentY = e.clientY;

    // 그리기 모드인 경우
    if (this.activeMode === 'drawing') {
      // 텍스트 도구는 별도 처리: 입력창 생성
      if (this.currentTool === 'text') {
        const x = Math.min(this.startX, currentX);
        const y = Math.min(this.startY, currentY);
        const w = Math.abs(currentX - this.startX);
        const h = Math.abs(currentY - this.startY);
        // 가이드 제거
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
        this.createTextInputAtRect(x, y, w, h);
        return;
      }

      // 임시 캔버스의 내용을 메인 캔버스로 복사 (펜 도구 제외)
      if (this.currentTool !== 'pen') {
        this.ctx.drawImage(this.tempCanvas, 0, 0);
        this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
      }

      // 전역 히스토리에 (before/after) 저장
      if (this._preDrawImage) {
        try {
          const afterImg = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
          this.pushHistoryEntry('drawing', this._preDrawImage, afterImg);
        } catch (_) { /* ignore */ }
        this._preDrawImage = null;
      }

      // 리사이즈 복원을 위한 상태 저장
      this.saveCanvasState();
      return;
    }

    // 영역 마스킹 모드인 경우
    if (this.activeMode === 'area_masking') {
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
    if (this.isAreaMaskingMode && this.activeMode === 'area_masking') {
      // 현재 활성 모드를 다시 실행 → 전체 초기화
      this.deactivateAreaMaskingMode();
      this.isDrawingMode = false;
      this.isAreaMaskingMode = false;
      this.activeMode = 'normal';
    } else {
      // 영역 마스킹 모드 활성화 (다른 모드는 유지)
      this.isAreaMaskingMode = true;
      this.activateAreaMaskingMode();
      this.setActiveMode('area_masking');
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
    document.body.classList.remove('sketch-drawing-mode');

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
    // 전체 시각 요소 초기화 (영역/그리기 모두)
    this.deactivateVisuals();
    this.showNotification(chrome.i18n.getMessage('notify_area_masking_off'), 'info');
  }

  createAreaMask(x, y, width, height) {
    // Undo용 현재 상태 스냅샷
    const pre = this.getAreaSnapshot();
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
    const blurPx = this.settings.areaBlur.blurIntensity;
    maskOverlay.style.cssText = `
      position: fixed;
      left: ${normalizedX}px;
      top: ${normalizedY}px;
      width: ${normalizedWidth}px;
      height: ${normalizedHeight}px;
      background-color: rgba(128, 128, 128, 0);
      backdrop-filter: blur(${blurPx}px);
      -webkit-backdrop-filter: blur(${blurPx}px);
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
      height: normalizedHeight,
      blurIntensity: blurPx
    });

    // 전역 히스토리에 (before/after) 저장
    const post = this.getAreaSnapshot();
    this.pushHistoryEntry('area', pre, post);

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

  // 오버레이/캔버스/영역 마스킹 등 시각 요소 전체 초기화 (텍스트 마스킹 제외)
  deactivateVisuals() {
    if (!this.overlay) return;

    // 오버레이 비활성화
    this.overlay.style.display = 'none';
    this.overlay.style.pointerEvents = 'none';
    this.overlay.style.cursor = 'default';

    // 페이지 스타일 복구
    document.body.style.userSelect = 'auto';
    document.body.classList.remove('sketch-drawing-mode');
    document.body.classList.remove('sketch-area-masking-mode');

    // 도구모음 복구
    if (this.toolbarContainer) {
      this.toolbarContainer.style.display = 'block';
    }

    // 캔버스 초기화
    this.clearCanvas();

    // 텍스트 입력창 제거
    if (this.isTextEditing) {
      this.removeTextInput();
    }

    // 모든 영역 마스킹 제거
    if (this.areaMasks.length > 0) {
      this.clearAllAreaMasks();
    }

    // 히스토리 초기화
    this.history.drawingUndo = [];
    this.history.drawingRedo = [];
    this.history.areaUndo = [];
    this.history.areaRedo = [];
    if (this.globalHistory) {
      this.globalHistory.undo = [];
      this.globalHistory.redo = [];
    }
    this._preDrawImage = null;
    this._areaPreSnapshot = null;
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
