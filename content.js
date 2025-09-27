class SketchMasking {
  constructor() {
    // 상수 정의
    this.CONSTANTS = {
      DEFAULT_TOOL: 'rectangle',
      CANVAS_STROKE_COLOR: '#FF0000',
      CANVAS_STROKE_WIDTH: 2,
      MIN_SCREEN_WIDTH: 1920,
      MIN_SCREEN_HEIGHT: 1080,
      Z_INDEX_OVERLAY: 2147483647,
      Z_INDEX_NOTIFICATION: 2147483648,
      NOTIFICATION_DURATION: 3000,
      TOOLBAR_UPDATE_DELAY: 10
    };

    // 도구 설정
    this.TOOLS = [
      { name: 'rectangle', icon: '▢', title: '박스' },
      { name: 'circle', icon: '○', title: '원' },
      { name: 'pen', icon: '✎', title: '펜' },
      { name: 'line', icon: '/', title: '선' },
      { name: 'close', icon: '✕', title: '닫기' }
    ];

    // 상태 변수들
    this.isDrawingMode = false;
    this.currentTool = this.CONSTANTS.DEFAULT_TOOL;
    this.isDrawing = false;
    this.toolbarCollapsed = false;

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

    this.init();
  }

  init() {
    this.createOverlay();
    this.setupEventListeners();
    this.setupKeyboardShortcuts();

    // 초기 도구 버튼 상태 설정 (requestAnimationFrame 사용으로 성능 개선)
    requestAnimationFrame(() => {
      this.updateToolbarButtons();
    });
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
    ctx.strokeStyle = this.CONSTANTS.CANVAS_STROKE_COLOR;
    ctx.lineWidth = this.CONSTANTS.CANVAS_STROKE_WIDTH;
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
    this.toggleButton.title = '도구모음 접기/펴기';

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
    const isActionButton = tool.name === 'close';

    button.innerHTML = tool.icon;
    button.title = tool.title;
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
      const isActionButton = toolName === 'close';

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
      this.toggleButton.title = '도구모음 펴기';
    } else {
      this.toolbar.classList.remove('collapsed');
      this.toggleButton.innerHTML = '◀';
      this.toggleButton.title = '도구모음 접기';
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
      }
      sendResponse({ status: 'success' });
    });
  }

  toggleDrawingMode() {
    this.isDrawingMode = !this.isDrawingMode;

    if (this.isDrawingMode) {
      // 오버레이가 DOM에 있는지 확인
      if (!document.body.contains(this.overlay)) {
        document.body.appendChild(this.overlay);
      }

      this.overlay.style.display = 'block';
      this.overlay.style.pointerEvents = 'all';
      this.overlay.style.zIndex = this.CONSTANTS.Z_INDEX_OVERLAY;
      document.body.style.userSelect = 'none';
      document.body.classList.add('sketch-drawing-mode');

      // DOM 렌더링 완료 후 크기 재설정
      requestAnimationFrame(() => {
        this.resizeCanvases();

        // 크기가 0이면 강제로 다시 설정
        if (this.overlay.offsetWidth === 0 || this.overlay.offsetHeight === 0) {
          this.forceOverlaySize();
        }

        // 기본 도구 설정 및 활성화 표시
        this.currentTool = this.CONSTANTS.DEFAULT_TOOL;
        this.updateToolbarButtons();
      });

      this.showNotification('🎨 그리기 모드 활성화', 'success');
    } else {
      // 그리기 모드 종료 시 모든 그림 및 마스킹 초기화
      this.clearCanvas();

      // 마스킹된 텍스트가 있으면 모두 해제
      if (this.maskedElements.length > 0) {
        this.unmaskAllText();
      }

      this.overlay.style.display = 'none';
      this.overlay.style.pointerEvents = 'none';
      document.body.style.userSelect = 'auto';
      document.body.classList.remove('sketch-drawing-mode');

      this.showNotification('🧹 그리기 모드 비활성화', 'info');
    }
  }

  startDrawing(e) {
    if (!this.isDrawingMode || e.target.closest('#sketch-toolbar-container')) return;

    this.isDrawing = true;
    this.startX = e.clientX;
    this.startY = e.clientY;

    // 캔버스 컨텍스트 설정 (유틸리티 메서드 사용)
    this.setupCanvasContext(this.ctx);

    if (this.currentTool === 'pen') {
      this.ctx.beginPath();
      this.ctx.moveTo(this.startX, this.startY);
    }
  }

  draw(e) {
    if (!this.isDrawing || !this.isDrawingMode) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    // 임시 캔버스 초기화 및 설정
    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    this.setupCanvasContext(this.tempCtx);

    // 도구별 그리기 처리
    this.drawWithTool(currentX, currentY);
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

    // 임시 캔버스의 내용을 메인 캔버스로 복사 (펜 도구 제외)
    if (this.currentTool !== 'pen') {
      this.ctx.drawImage(this.tempCanvas, 0, 0);
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    }

    // 실행 취소를 위한 상태 저장
    this.saveCanvasState();
  }

  saveCanvasState() {
    this.paths.push({
      imageData: this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
    });
  }


  clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
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
    const selection = window.getSelection();

    // 선택된 텍스트가 있는 경우 - 마스킹 수행
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const selectedText = range.toString();

      if (selectedText.trim()) {
        // 각 문자를 *로 교체하되, 공백은 유지
        const maskedText = selectedText.replace(/\S/g, '*');

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

          this.showNotification("텍스트 마스킹 완료", 'success');
        } catch (error) {
          this.showNotification('이 영역의 텍스트는 마스킹할 수 없습니다', 'error');
        }
      } else {
        if (this.maskedElements.length > 0) {
          this.unmaskAllText();
          this.showNotification('마스킹이 해제되었습니다', 'info');
        } else {
          this.showNotification('마스킹할 텍스트를 선택해주세요', 'error');
        }
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
      this.showNotification(`마스킹 해제 완료(${unmaskedCount}개 영역)`, 'success');
    } else {
      this.showNotification('해제할 마스킹된 텍스트가 없습니다', 'info');
    }
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

