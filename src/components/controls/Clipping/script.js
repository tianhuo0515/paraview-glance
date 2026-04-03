import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkClipClosedSurface from '@kitware/vtk.js/Filters/General/ClipClosedSurface';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

const AXES = ['X', 'Y', 'Z'];

/**
 * Manually convert a specific cellData array to pointData.
 * For each point, averages the values of all cells that use that point.
 */
function convertCellDataArrayToPointData(polyData, arrayName) {
  const cellArray = polyData.getCellData().getArrayByName(arrayName);
  if (!cellArray) {
    return null;
  }

  const points = polyData.getPoints();
  const polys = polyData.getPolys();
  if (!points || !polys) {
    return null;
  }

  const numPts = points.getNumberOfPoints();
  const numComps = cellArray.getNumberOfComponents();
  const totalValues = numPts * numComps;
  const sumArray = new Float64Array(totalValues);
  const countArray = new Uint32Array(numPts);

  // Iterate over all cells and accumulate point data
  const cellData = polys.getData();
  let offset = 0;
  let cellId = 0;
  while (offset < cellData.length) {
    const numPtsInCell = cellData[offset++];
    for (let i = 0; i < numPtsInCell; i++) {
      const ptId = cellData[offset++];
      const baseIdx = ptId * numComps;
      for (let c = 0; c < numComps; c++) {
        sumArray[baseIdx + c] += cellArray.getComponent(cellId, c);
      }
      countArray[ptId]++;
    }
    cellId++;
  }

  // Compute averages
  for (let ptId = 0; ptId < numPts; ptId++) {
    if (countArray[ptId] > 0) {
      const baseIdx = ptId * numComps;
      const invCount = 1.0 / countArray[ptId];
      for (let c = 0; c < numComps; c++) {
        sumArray[baseIdx + c] *= invCount;
      }
    }
  }

  return vtkDataArray.newInstance({
    name: arrayName,
    numberOfComponents: numComps,
    values: sumArray,
    dataType: 'Float64Array',
  });
}

export default {
  name: 'Clipping',
  props: ['sourceId'],
  data() {
    return {
      axes: AXES.map((axis) => ({
        axis,
        enabled: false,
        value: 0,
        flipped: false,
      })),
      bounds: [0, 0, 0, 0, 0, 0],
      originalDataset: null,
      savedColorBy: null,
    };
  },
  computed: {
    source() {
      return this.$proxyManager.getProxyById(this.sourceId);
    },
    hasAnyClipping() {
      return this.axes.some((a) => a.enabled);
    },
  },
  proxyManagerHooks: {
    onProxyRegistrationChange() {
      this.resetClipping();
    },
  },
  mounted() {
    this.resetClipping();
  },
  beforeDestroy() {
    this.restoreOriginalDataset();
  },
  methods: {
    getGeometryRepresentations() {
      if (!this.source) {
        return [];
      }
      return this.$proxyManager
        .getRepresentations()
        .filter(
          (r) => r.getInput() === this.source && r.getProxyName() === 'Geometry'
        );
    },

    resetClipping() {
      this.restoreOriginalDataset();
      this.updateBounds();
    },

    updateBounds() {
      if (!this.source) {
        return;
      }
      const dataset = this.source.getDataset();
      if (dataset && dataset.getBounds) {
        this.bounds = dataset.getBounds();
      }
    },

    getOriginForAxis(axis, value) {
      const idx = AXES.indexOf(axis);
      const min = this.bounds[idx * 2];
      const max = this.bounds[idx * 2 + 1];
      return [0, 0, 0].map((_, i) =>
        i === idx ? min + (max - min) * value : 0
      );
    },

    getNormalForAxis(axis) {
      return [0, 0, 0].map((_, i) => (i === AXES.indexOf(axis) ? 1 : 0));
    },

    restoreOriginalDataset() {
      if (this.originalDataset && this.source) {
        // Restore original dataset first
        this.source.setInputData(this.originalDataset);

        // Then restore colorBy with original settings
        if (this.savedColorBy && this.savedColorBy.length > 0) {
          const allReps = this.$proxyManager
            .getRepresentations()
            .filter((r) => r.getInput() === this.source);
          allReps.forEach((rep) => {
            if (rep.setColorBy) {
              rep.setColorBy(
                this.savedColorBy[0],
                this.savedColorBy[1],
                this.savedColorBy.length > 2 ? this.savedColorBy[2] : -1
              );
            }
          });
        }

        this.originalDataset = null;
        this.savedColorBy = null;
        this.$proxyManager.renderAllViews();
      }
    },

    applyClipping() {
      const reps = this.getGeometryRepresentations();
      if (!reps.length) {
        return;
      }

      // Save original dataset if not yet saved
      if (!this.originalDataset) {
        this.originalDataset = this.source.getDataset();
        // Save colorBy at the same time
        const geoRep = reps.find((r) => r.getProxyName() === 'Geometry');
        this.savedColorBy = geoRep ? geoRep.getColorBy() : null;
      }

      if (!this.hasAnyClipping) {
        this.restoreOriginalDataset();
        return;
      }

      // Build clipping planes from enabled axes
      const planes = [];
      for (let j = 0; j < this.axes.length; j++) {
        const axisData = this.axes[j];
        if (axisData.enabled) {
          const plane = vtkPlane.newInstance();
          let normal = this.getNormalForAxis(axisData.axis);
          if (axisData.flipped) {
            normal = normal.map((n) => -n);
          }
          const origin = this.getOriginForAxis(axisData.axis, axisData.value);
          plane.setNormal(normal);
          plane.setOrigin(origin);
          planes.push(plane);
        }
      }

      if (planes.length === 0) {
        this.restoreOriginalDataset();
        return;
      }

      // Prepare dataset: if colorBy uses cellData, convert to pointData
      // because vtkClipClosedSurface only supports passPointData
      const colorByArrayName = this.savedColorBy[0];
      const colorByLocation = this.savedColorBy[1];
      const colorByComponent =
        this.savedColorBy.length > 2 ? this.savedColorBy[2] : -1;

      let datasetToClip = this.originalDataset;
      let finalColorByLocation = colorByLocation;

      if (colorByLocation === 'cellData') {
        const pointArray = convertCellDataArrayToPointData(
          this.originalDataset,
          colorByArrayName
        );
        if (pointArray) {
          // Shallow copy the dataset and add the pointData array
          datasetToClip = this.originalDataset;
          datasetToClip.getPointData().addArray(pointArray);
          finalColorByLocation = 'pointData';
        }
      }

      // Apply vtkClipClosedSurface filter
      const clipper = vtkClipClosedSurface.newInstance({
        clippingPlanes: planes,
        triangulatePolys: true,
        passPointData: true,
      });

      clipper.setInputData(datasetToClip);
      clipper.update();
      const clipped = clipper.getOutputData();

      // Replace source dataset
      this.source.setInputData(clipped);

      // Restore colorBy
      const fieldData = clipped.getPointData();
      const arrayExists = fieldData
        ? fieldData.getArrayByName(colorByArrayName)
        : null;

      if (arrayExists) {
        const allReps = this.$proxyManager
          .getRepresentations()
          .filter((r) => r.getInput() === this.source);
        allReps.forEach((rep) => {
          if (rep.setColorBy) {
            rep.setColorBy(
              colorByArrayName,
              finalColorByLocation,
              colorByComponent
            );
          }
        });
      }
      this.$proxyManager.renderAllViews();
    },

    toggleAxis(axis) {
      const axisData = this.axes.find((a) => a.axis === axis);
      if (axisData) {
        axisData.enabled = !axisData.enabled;
        this.applyClipping();
      }
    },

    onSliderChange(axis, value) {
      const axisData = this.axes.find((a) => a.axis === axis);
      if (axisData) {
        axisData.value = value;
        this.applyClipping();
      }
    },

    onInputChange(axis, value) {
      const num = Number(value);
      if (Number.isNaN(num)) {
        return;
      }
      const clamped = Math.max(0, Math.min(1, num));
      this.onSliderChange(axis, clamped);
    },

    flipAxis(axis) {
      const axisData = this.axes.find((a) => a.axis === axis);
      if (axisData) {
        axisData.flipped = !axisData.flipped;
        this.applyClipping();
      }
    },

    resetAxis(axis) {
      const axisData = this.axes.find((a) => a.axis === axis);
      if (axisData) {
        axisData.enabled = false;
        axisData.value = 0;
        axisData.flipped = false;
        this.applyClipping();
      }
    },
  },
};
