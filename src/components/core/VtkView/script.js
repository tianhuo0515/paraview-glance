import { mapState, mapGetters, mapActions } from 'vuex';

import vtkScalarBarActor from '@kitware/vtk.js/Rendering/Core/ScalarBarActor';

import { Breakpoints } from 'paraview-glance/src/constants';
import {
  ANNOTATIONS,
  DEFAULT_VIEW_TYPE,
} from 'paraview-glance/src/components/core/VtkView/constants';

import PalettePicker from 'paraview-glance/src/components/widgets/PalettePicker';
import ToolbarSheet from 'paraview-glance/src/components/core/ToolbarSheet';
import { BACKGROUND } from 'paraview-glance/src/components/core/VtkView/palette';
import ToolSvgTarget from 'paraview-glance/src/components/tools/ToolSvgTarget';

import { updateViewOrientationFromBasisAndAxis } from 'paraview-glance/src/utils';

function getComponentLabel(numComponents, componentIndex) {
  if (numComponents === 3) {
    return ['X', 'Y', 'Z'][componentIndex];
  }
  // 6分量(Voigt)或9分量(全张量)，统一只显示6个对称分量标签
  const labels = ['XX', 'YY', 'ZZ', 'XY', 'YZ', 'XZ'];
  if (numComponents === 9) {
    const indices = [0, 4, 8, 1, 5, 2];
    const pos = indices.indexOf(componentIndex);
    return pos >= 0 ? labels[pos] : `分量${componentIndex}`;
  }
  return labels[componentIndex] || `分量${componentIndex}`;
}

const ROTATION_STEP = 2;

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export default {
  name: 'VtkView',
  components: {
    PalettePicker,
    ToolbarSheet,
    ToolSvgTarget,
  },
  props: {
    layoutIndex: {
      default: 0,
      type: Number,
    },
    layoutCount: {
      default: 1,
      type: Number,
    },
    viewType: {
      default: '',
      type: String,
    },
    backgroundColor: {
      default: '#000',
      type: String,
    },
  },
  data() {
    return {
      internalViewId: -1,
      internalIsActive: false,
      palette: BACKGROUND,
      backgroundSheet: false,
      inAnimation: false,
      viewPointMenuVisible: false,
      svgViewBox: '0 0 10 10',
      scalarBarActor: null,
    };
  },
  computed: {
    ...mapState('views', {
      viewProxyId(state) {
        return state.viewTypeToId[this.viewType];
      },
      view(state) {
        return this.$proxyManager.getProxyById(
          state.viewTypeToId[this.viewType]
        );
      },
      axisVisible(state) {
        return state.axisVisible;
      },
      axisType(state) {
        return state.axisType;
      },
      axisPreset(state) {
        return state.axisPreset;
      },
      viewOrientation(state) {
        return state.viewOrientation;
      },
      viewTypeItems(state) {
        return Object.entries(state.viewTypes).map(([viewType, text]) => ({
          text,
          value: viewType,
        }));
      },
    }),
    ...mapGetters(['cameraViewPoints']),
    type() {
      return this.viewType.split(':')[0];
    },
    name() {
      return this.viewType.split(':')[1];
    },
    orientationLabels() {
      return this.axisPreset === 'lps' ? ['L', 'P', 'S'] : ['X', 'Y', 'Z'];
    },
    smallScreen() {
      return this.$vuetify.breakpoint.width < Breakpoints.md;
    },
    singleViewButton() {
      return this.layoutCount > 1;
    },
    flipViewButton() {
      return (
        this.layoutCount === 1 ||
        (this.layoutCount === 4 && this.layoutIndex % 2 === 1)
      );
    },
    quadViewButton() {
      return this.layoutCount === 2 && this.layoutIndex === 1;
    },
    isActive() {
      return (
        this.internalIsActive ||
        this.view === this.$proxyManager.getActiveView()
      );
    },
  },
  watch: {
    view(view) {
      this.tryMountView(view);
    },
    layoutCount() {
      if (this.scalarBarActor) {
        this.$nextTick(() => {
          this.updateScalarBar();
        });
      }
    },
  },
  proxyManagerHooks: {
    onActiveViewChange(view) {
      this.internalIsActive = view === this.view;
    },
    onActiveSourceChange(source) {
      if (
        source &&
        source.getProxyName() === 'TrivialProducer' &&
        this.view.bindRepresentationToManipulator
      ) {
        const representation = this.$proxyManager.getRepresentation(
          source,
          this.view
        );
        this.view.bindRepresentationToManipulator(representation);
        this.view.updateWidthHeightAnnotation();
      }

      // Update scalar bar when active source changes
      if (this.scalarBarActor) {
        this.updateScalarBar();
      }
    },
    onProxyRegistrationChange() {
      // update views annotation
      const hasImageData = this.$proxyManager
        .getSources()
        .find((s) => s.getDataset().isA && s.getDataset().isA('vtkImageData'));
      const views = this.$proxyManager.getViews();

      for (let i = 0; i < views.length; i++) {
        const view = views[i];
        view.setCornerAnnotation('se', '');
        if (view.getProxyName().indexOf('2D') !== -1 && hasImageData) {
          view.setCornerAnnotations(ANNOTATIONS, true);
        } else {
          view.setCornerAnnotation('nw', '');
        }
      }

      // Update scalar bar for all views
      if (this.scalarBarActor) {
        this.updateScalarBar();
      }
    },
  },
  mounted() {
    if (this.view) {
      this.tryMountView(this.view);
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCurrentView();
    });
    this.resizeObserver.observe(this.$el);

    // Initial setup
    this.resizeCurrentView();

    // Poll for colorBy changes to update scalar bar
    this._lastColorBy = '';
    this._scalarBarPollInterval = setInterval(() => {
      this.pollScalarBarUpdate();
    }, 300);
    this._onColorByChanged = () => this.updateScalarBar();
    this.$root.$on('colorBy-changed', this._onColorByChanged);
  },
  beforeDestroy() {
    this.resizeObserver.disconnect();
    if (this._scalarBarPollInterval) {
      clearInterval(this._scalarBarPollInterval);
    }
    if (this._onColorByChanged) {
      this.$root.$off('colorBy-changed', this._onColorByChanged);
    }
    if (this.view) {
      this.unmountView(this.view);
    }
  },
  beforeUpdate() {
    if (!this.view) {
      this.changeViewType(DEFAULT_VIEW_TYPE);
    }
  },
  methods: {
    tryMountView(view) {
      if (this.internalViewId > -1) {
        const oldView = this.$proxyManager.getProxyById(this.internalViewId);
        this.unmountView(oldView);
        this.internalViewId = -1;
      }

      if (view) {
        this.internalViewId = view.getProxyId();
        view.setContainer(this.$el.querySelector('.js-view'));
        view.setOrientationAxesVisibility(this.axisVisible);

        // Add scalar bar actor
        this.setupScalarBar(view);

        const widgetManager = view.getReferenceByName('widgetManager');
        if (widgetManager) {
          // workaround to disable picking if previously disabled
          if (!widgetManager.getPickingEnabled()) {
            widgetManager.disablePicking();
          }
        }
      }
    },
    unmountView(view) {
      // Remove scalar bar actor
      if (this.scalarBarActor && view) {
        view.getRenderer().removeActor(this.scalarBarActor);
      }
      view.setContainer(null);
    },
    changeViewType(viewType) {
      this.swapViews({
        index: this.layoutIndex,
        viewType,
      });
    },
    getAvailableActions() {
      return {
        single: this.layoutCount > 1,
        split: this.layoutCount < 4,
      };
    },
    resetCamera() {
      if (this.view) {
        this.view.resetCamera();
      }
    },
    rollLeft() {
      if (this.view) {
        this.view.setAnimation(true, this);
        let count = 0;
        let intervalId = null;
        const rotate = () => {
          if (count < 90) {
            count += ROTATION_STEP;
            this.view.rotate(+ROTATION_STEP);
          } else {
            clearInterval(intervalId);
            this.view.setAnimation(false, this);
          }
        };
        intervalId = setInterval(rotate, 1);
      }
    },
    rollRight() {
      if (this.view) {
        this.view.setAnimation(true, this);
        let count = 0;
        let intervalId = null;
        const rotate = () => {
          if (count < 90) {
            count += ROTATION_STEP;
            this.view.rotate(-ROTATION_STEP);
          } else {
            clearInterval(intervalId);
            this.view.setAnimation(false, this);
          }
        };
        intervalId = setInterval(rotate, 1);
      }
    },
    updateOrientation(mode) {
      if (this.view && !this.inAnimation) {
        this.inAnimation = true;
        updateViewOrientationFromBasisAndAxis(
          this.view,
          this.viewOrientation,
          mode,
          this.type === 'View3D' ? 100 : 0
        ).then(() => {
          this.inAnimation = false;
        });
      }
    },
    resizeCurrentView() {
      if (this.view) {
        this.view.resize();

        const [w, h] = this.view.getOpenGLRenderWindow().getSize();
        this.svgViewBox = `0 0 ${w} ${h}`;
      }
    },
    screenCapture() {
      this.takeScreenshot(this.view);
    },
    changeBackgroundColor(color) {
      this.changeBackground({
        viewType: this.viewType,
        color,
      });
    },
    ...mapActions('views', [
      'changeBackground',
      'swapViews',
      'singleView',
      'splitView',
      'quadView',
    ]),
    ...mapActions(['takeScreenshot', 'changeCameraViewPoint']),
    setupScalarBar(view) {
      if (!this.scalarBarActor) {
        this.scalarBarActor = vtkScalarBarActor.newInstance({
          automated: true,
          axisLabel: '',
          drawNanAnnotation: false,
          drawBelowRangeSwatch: false,
          drawAboveRangeSwatch: false,
          // 自定义刻度生成：按上下限均匀分布，保留实际精度
          generateTicks: (helper) => {
            const bounds = helper.getLastTickBounds();
            const min = bounds[0];
            const max = bounds[1];
            const numTicks = 5;

            // 均匀分布刻度
            const ticks = [];
            for (let i = 0; i < numTicks; i++) {
              let t;
              if (i === 0) {
                t = min;
              } else if (i === numTicks - 1) {
                t = max;
              } else {
                t = min + ((max - min) * i) / (numTicks - 1);
              }
              ticks.push(t);
            }

            // 根据步长确定小数位数，保证相邻刻度可区分
            const step = (max - min) / (numTicks - 1);
            const decimals =
              step > 0 ? Math.max(0, Math.ceil(-Math.log10(step)) + 1) : 0;

            const formatTick = (v) => {
              if (Number.isInteger(v)) return String(v);
              return v.toFixed(Math.min(decimals, 8));
            };

            helper.setTicks(ticks);
            helper.setTickStrings(ticks.map(formatTick));
          },
          axisTextStyle: {
            fontColor: 'white',
            fontStyle: 'normal',
            fontFamily: 'Arial',
            fontSize: '16',
          },
          tickTextStyle: {
            fontColor: 'white',
            fontStyle: 'normal',
            fontFamily: 'Arial',
            fontSize: '14',
          },
        });
      }
      view.getRenderer().addActor(this.scalarBarActor);
      this.updateScalarBar();
    },
    pollScalarBarUpdate() {
      if (!this.scalarBarActor || !this.$proxyManager) {
        return;
      }
      const activeSource = this.$proxyManager.getActiveSource();
      if (!activeSource) {
        return;
      }
      const reps = this.$proxyManager
        .getRepresentations()
        .filter((r) => r.getInput() === activeSource);
      const geoRep = reps.find((r) => r.getProxyName() === 'Geometry');

      let currentColorBy = '';
      if (geoRep) {
        const colorByValue = geoRep.getColorBy();
        if (colorByValue && colorByValue[0]) {
          currentColorBy = colorByValue.join('|');
        }
      }

      // Only update if colorBy actually changed
      if (currentColorBy !== this._lastColorBy) {
        this._lastColorBy = currentColorBy;
        this.updateScalarBar();
      }
    },
    updateScalarBar() {
      if (!this.scalarBarActor) {
        return;
      }
      const activeSource = this.$proxyManager.getActiveSource();
      if (!activeSource) {
        this.scalarBarActor.setVisibility(false);
        return;
      }

      const dataset = activeSource.getDataset();
      if (!dataset) {
        this.scalarBarActor.setVisibility(false);
        return;
      }

      // Find the scalar array used for coloring
      const reps = this.$proxyManager
        .getRepresentations()
        .filter((r) => r.getInput() === activeSource);
      const geoRep = reps.find((r) => r.getProxyName() === 'Geometry');

      if (!geoRep) {
        this.scalarBarActor.setVisibility(false);
        return;
      }

      const colorByValue = geoRep.getColorBy();
      if (!colorByValue || !colorByValue[0]) {
        // Original model mode - hide scalar bar
        this.scalarBarActor.setVisibility(false);
        return;
      }

      const arrayName = colorByValue[0];

      // 从 lookupTable 读取分量模式（vtk.js 的 setColorBy 设置在 lut 上）
      const lutProxy = this.$proxyManager.getLookupTable(arrayName);
      if (!lutProxy) {
        this.scalarBarActor.setVisibility(false);
        return;
      }

      const lut = lutProxy.getLookupTable();
      let componentIndex = -1;
      if (lut && lut.getVectorMode() === 1) {
        componentIndex = lut.getVectorComponent();
      }

      // 获取当前着色数组的分量数
      const fieldData =
        colorByValue[1] === 'pointData'
          ? dataset.getPointData()
          : dataset.getCellData();
      const activeArray = fieldData
        ? fieldData.getArrayByName(arrayName)
        : null;
      const numComp = activeArray ? activeArray.getNumberOfComponents() : 1;

      let label = arrayName;
      if (componentIndex === -1 && numComp > 1) {
        label = `${arrayName} (幅值)`;
      } else if (componentIndex >= 0) {
        const compLabel = getComponentLabel(numComp, componentIndex);
        label = `${arrayName} (${compLabel})`;
      }

      if (lut) {
        this.scalarBarActor.setScalarsToColors(lut);
        this.scalarBarActor.setAxisLabel(label);
        this.scalarBarActor.setVisibility(true);
        // 防止范围未就绪时显示 NaN
        if (lut.getRange) {
          const range = lut.getRange();
          if (Number.isNaN(range[0]) || Number.isNaN(range[1])) {
            this.scalarBarActor.setVisibility(false);
            return;
          }
        }
        this.$proxyManager.renderAllViews();
      }
    },
  },
};
