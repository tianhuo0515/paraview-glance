import Datasets from 'paraview-glance/src/components/core/Datasets';

// ----------------------------------------------------------------------------

export default {
  name: 'ControlsDrawer',
  components: {
    Datasets,
  },
  data() {
    return {
      activeTab: 0,
    };
  },
};
