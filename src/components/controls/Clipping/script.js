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
      originalDataset: null, // Original unmodified dataset
      savedColorBy: null, // ColorBy when clipping started
      convertedArrays: new Set(), // Track which arrays have been converted to pointData
      _skipNextColorByEvent: false, // Guard to skip redundant colorBy-changed event
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
    onProxyRegistrationChange({ proxyGroup }) {
      // Only reset clipping on Sources change, not on Representations change
      // ColorBy changes trigger Representation changes which should not reset clipping
      if (proxyGroup === 'Sources') {
        this.resetClipping();
      }
    },
  },
  mounted() {
    this.resetClipping();
    // Listen for colorBy changes to update clipped data
    this.$root.$on('colorBy-changed', this.onColorByChanged);
  },
  beforeDestroy() {
    this.restoreOriginalDataset();
    this.$root.$off('colorBy-changed', this.onColorByChanged);
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
        // Restore original dataset
        this.source.setInputData(this.originalDataset);

        // Restore colorBy with original settings
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

        // Clear saved state
        this.originalDataset = null;
        this.savedColorBy = null;
        this.convertedArrays.clear();
        this.$proxyManager.renderAllViews();
      }
    },

    // Update colorBy on the current clipped dataset by re-clipping
    // This ensures cellData→pointData conversion is properly interpolated
    // for the clipped geometry, avoiding tuple count mismatches.
    reclipWithColorBy(currentColorBy) {
      if (!currentColorBy || currentColorBy.length < 2) {
        console.log('[Clipping] reclipWithColorBy: invalid colorBy, skipping');
        return;
      }

      // Must have originalDataset
      if (!this.originalDataset) {
        console.log('[Clipping] Cannot reclip: originalDataset is null');
        return;
      }

      const colorByArrayName = currentColorBy[0];
      const colorByLocation = currentColorBy[1];
      const colorByComponent =
        currentColorBy.length > 2 ? currentColorBy[2] : -1;
      let finalColorByLocation = colorByLocation;

      // Prepare the dataset for clipping (same as applyClipping)
      const datasetToClip = this.originalDataset;

      // If colorBy uses cellData, pre-convert to pointData on the ORIGINAL dataset
      // so that ClipClosedSurface's interpolateData handles it correctly
      if (colorByLocation === 'cellData') {
        if (!this.convertedArrays.has(colorByArrayName)) {
          const pointArray = convertCellDataArrayToPointData(
            datasetToClip,
            colorByArrayName
          );
          if (pointArray) {
            datasetToClip.getPointData().addArray(pointArray);
            this.convertedArrays.add(colorByArrayName);
            console.log(
              '[Clipping] Pre-converted cellData→pointData on original:',
              colorByArrayName
            );
          } else {
            console.log(
              '[Clipping] Warning: failed to convert cellData:',
              colorByArrayName
            );
            return;
          }
        }
        finalColorByLocation = 'pointData';
      } else if (colorByLocation === 'pointData') {
        // For pointData, check if it exists in the original dataset
        const origPointData = datasetToClip.getPointData();
        const origArray = origPointData
          ? origPointData.getArrayByName(colorByArrayName)
          : null;
        if (!origArray) {
          console.log(
            '[Clipping] Warning: pointData array not found in original:',
            colorByArrayName
          );
          return;
        }
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
        console.log('[Clipping] reclipWithColorBy: no planes, skipping');
        return;
      }

      // Apply clipping
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

      // Verify the colorBy array exists in clipped data
      const fieldData = clipped.getPointData();
      const arrayExists = fieldData
        ? fieldData.getArrayByName(colorByArrayName)
        : null;

      if (arrayExists) {
        // Update colorBy on all representations
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
        console.log(
          '[Clipping] Re-clipped with new colorBy:',
          colorByArrayName,
          'location:',
          finalColorByLocation,
          'component:',
          colorByComponent
        );
      } else {
        console.log(
          '[Clipping] Warning: colorBy array not found after clipping:',
          colorByArrayName
        );
      }

      this.$proxyManager.renderAllViews();
    },

    applyClipping() {
      // Skip if we're in the middle of a re-clip triggered by colorBy change
      if (this._skipNextColorByEvent) {
        return;
      }

      const reps = this.getGeometryRepresentations();
      if (!reps.length) {
        return;
      }

      // Get current colorBy from representation
      const geoRep = reps.find((r) => r.getProxyName() === 'Geometry');
      let currentColorBy = geoRep ? geoRep.getColorBy() : null;

      // If no clipping enabled, restore and exit
      if (!this.hasAnyClipping) {
        this.restoreOriginalDataset();
        return;
      }

      // Save original dataset BEFORE any validation
      // This ensures originalDataset is always available when clipping is active
      if (!this.originalDataset) {
        this.originalDataset = this.source.getDataset();
        // Only set savedColorBy if not already set by onColorByChanged
        if (!this.savedColorBy) {
          this.savedColorBy = currentColorBy ? [...currentColorBy] : null;
        }
        console.log('[Clipping] Saved original dataset:', {
          hasOriginalDataset: !!this.originalDataset,
          savedColorBy: this.savedColorBy,
        });
      }

      const datasetToClip = this.originalDataset;

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

      // Validate currentColorBy - if invalid, still apply clipping but use default
      if (!currentColorBy || currentColorBy.length < 2) {
        console.log(
          '[Clipping] Warning: currentColorBy invalid, using default:',
          currentColorBy
        );
        // Use a default colorBy from the dataset if available
        const pointData = datasetToClip.getPointData();
        const cellData = datasetToClip.getCellData();
        let defaultArrayName = null;
        let defaultLocation = 'pointData';

        if (pointData && pointData.getNumberOfArrays() > 0) {
          defaultArrayName = pointData.getArrayByIndex(0).getName();
        } else if (cellData && cellData.getNumberOfArrays() > 0) {
          defaultArrayName = cellData.getArrayByIndex(0).getName();
          defaultLocation = 'cellData';
        }

        if (defaultArrayName) {
          currentColorBy = [defaultArrayName, defaultLocation, -1];
          console.log('[Clipping] Using default colorBy:', currentColorBy);
        } else {
          console.log('[Clipping] No arrays available, skipping clip');
          return;
        }
      }

      const colorByArrayName = currentColorBy[0];
      const colorByLocation = currentColorBy[1];
      const colorByComponent =
        currentColorBy.length > 2 ? currentColorBy[2] : -1;
      let finalColorByLocation = colorByLocation;

      // If colorBy uses cellData, convert to pointData
      // vtkClipClosedSurface only supports passPointData
      if (colorByLocation === 'cellData') {
        // Check if we already converted this array
        if (!this.convertedArrays.has(colorByArrayName)) {
          const pointArray = convertCellDataArrayToPointData(
            datasetToClip,
            colorByArrayName
          );
          if (pointArray) {
            datasetToClip.getPointData().addArray(pointArray);
            this.convertedArrays.add(colorByArrayName);
          }
        }
        finalColorByLocation = 'pointData';
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
      const axisIndex = this.axes.findIndex((a) => a.axis === axis);
      if (axisIndex !== -1) {
        // Use Vue.set to ensure reactivity
        this.$set(
          this.axes[axisIndex],
          'enabled',
          !this.axes[axisIndex].enabled
        );
        console.log(
          '[Clipping] toggleAxis:',
          axis,
          'enabled:',
          this.axes[axisIndex].enabled
        );
        this.applyClipping();
      }
    },

    onSliderChange(axis, value) {
      const axisIndex = this.axes.findIndex((a) => a.axis === axis);
      if (axisIndex !== -1) {
        this.$set(this.axes[axisIndex], 'value', value);
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
      const axisIndex = this.axes.findIndex((a) => a.axis === axis);
      if (axisIndex !== -1) {
        this.$set(
          this.axes[axisIndex],
          'flipped',
          !this.axes[axisIndex].flipped
        );
        this.applyClipping();
      }
    },

    resetAxis(axis) {
      const axisIndex = this.axes.findIndex((a) => a.axis === axis);
      if (axisIndex !== -1) {
        this.$set(this.axes[axisIndex], 'enabled', false);
        this.$set(this.axes[axisIndex], 'value', 0);
        this.$set(this.axes[axisIndex], 'flipped', false);
        this.applyClipping();
      }
    },

    // Handle colorBy change event from ColorBy component
    onColorByChanged(sourceId, newColorBy) {
      console.log(
        '[Clipping] onColorByChanged called, sourceId:',
        sourceId,
        'my sourceId:',
        this.sourceId,
        'hasAnyClipping:',
        this.hasAnyClipping,
        'newColorBy:',
        newColorBy,
        'hasOriginalDataset:',
        !!this.originalDataset
      );

      // Only handle if this event is for our source
      if (sourceId && sourceId !== this.sourceId) {
        console.log('[Clipping] Event for different source, skipping');
        return;
      }

      // Skip if we're already processing a re-clip (prevents infinite recursion)
      if (this._skipNextColorByEvent) {
        this._skipNextColorByEvent = false;
        console.log(
          '[Clipping] onColorByChanged: skipping duplicate (re-clip refresh)'
        );
        return;
      }

      // Only handle if clipping is active
      if (!this.hasAnyClipping) {
        console.log(
          '[Clipping] onColorByChanged: clipping not active, skipping'
        );
        return;
      }

      // Must have originalDataset
      if (!this.originalDataset) {
        console.log(
          '[Clipping] onColorByChanged skipped: originalDataset is null'
        );
        return;
      }

      // Use the passed colorBy value if available, otherwise query from representation
      let currentColorBy = newColorBy;
      if (!currentColorBy || currentColorBy.length < 2) {
        const reps = this.getGeometryRepresentations();
        const geoRep = reps.find((r) => r.getProxyName() === 'Geometry');
        currentColorBy = geoRep ? geoRep.getColorBy() : null;
      }

      // Validate currentColorBy
      if (!currentColorBy || currentColorBy.length < 2) {
        console.log(
          '[Clipping] onColorByChanged: invalid currentColorBy, skipping'
        );
        return;
      }

      console.log('[Clipping] onColorByChanged processing:', {
        current: currentColorBy,
        saved: this.savedColorBy,
      });

      // Always update color on clipped data when clipping is active
      console.log('[Clipping] Re-clipping with new colorBy');
      // Update saved colorBy
      this.savedColorBy = [...currentColorBy];
      // Set flag so applyClipping won't re-run during our re-clip
      this._skipNextColorByEvent = true;
      // Re-clip with the new colorBy array
      this.reclipWithColorBy(currentColorBy);
      // Release flag after Vue finishes processing all pending watchers
      this.$nextTick(() => {
        this._skipNextColorByEvent = false;
      });
    },
  },
};
