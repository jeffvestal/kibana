/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  AreaSeriesProps,
  AreaSeriesStyle,
  BarSeriesProps,
  ColorVariant,
  LineSeriesProps,
  ScaleType,
  SeriesName,
  StackMode,
  XYChartSeriesIdentifier,
  SeriesColorAccessorFn,
} from '@elastic/charts';
import { IFieldFormat } from '@kbn/field-formats-plugin/common';
import type { PersistedState } from '@kbn/visualizations-plugin/public';
import { Datatable } from '@kbn/expressions-plugin/common';
import { getAccessorByDimension } from '@kbn/visualizations-plugin/common/utils';
import type { ExpressionValueVisDimension } from '@kbn/visualizations-plugin/common/expression_functions';
import { PaletteRegistry, SeriesLayer } from '@kbn/coloring';
import { getColorCategories } from '@kbn/chart-expressions-common';
import { KbnPalettes } from '@kbn/palettes';
import { RawValue } from '@kbn/data-plugin/common';
import { isDataLayer } from '../../common/utils/layer_types_guards';
import {
  CommonXYDataLayerConfig,
  CommonXYLayerConfig,
  XScaleType,
  PointVisibility,
} from '../../common';
import { AxisModes, SeriesTypes } from '../../common/constants';
import { FormatFactory } from '../types';
import { getSeriesColor } from './state';
import { ColorAssignments } from './color_assignment';
import { GroupsConfiguration } from './axes_configuration';
import { LayerAccessorsTitles, LayerFieldFormats, LayersFieldFormats } from './layers';
import { getFormat } from './format';
import { getColorSeriesAccessorFn } from './color/color_mapping_accessor';

type SeriesSpec = LineSeriesProps & BarSeriesProps & AreaSeriesProps;
export type InvertedRawValueMap = Map<string, Map<string, RawValue>>;

type GetSeriesPropsFn = (config: {
  layer: CommonXYDataLayerConfig;
  titles?: LayerAccessorsTitles;
  accessor: string | string[];
  chartHasMoreThanOneBarSeries?: boolean;
  formatFactory: FormatFactory;
  colorAssignments: ColorAssignments;
  columnToLabelMap: Record<string, string>;
  paletteService: PaletteRegistry;
  palettes: KbnPalettes;
  yAxis?: GroupsConfiguration[number];
  xAxis?: GroupsConfiguration[number];
  syncColors: boolean;
  timeZone: string;
  emphasizeFitting?: boolean;
  fillOpacity?: number;
  formattedDatatableInfo: DatatableWithFormatInfo;
  defaultXScaleType: XScaleType;
  fieldFormats: LayersFieldFormats;
  uiState?: PersistedState;
  allYAccessors: Array<string | ExpressionValueVisDimension>;
  singleTable?: boolean;
  multipleLayersWithSplits: boolean;
  isDarkMode: boolean;
  pointVisibility?: PointVisibility;
}) => SeriesSpec;

type GetSeriesNameFn = (
  data: XYChartSeriesIdentifier,
  config: {
    splitAccessors: Array<string | ExpressionValueVisDimension>;
    accessorsCount: number;
    columns: Datatable['columns'];
    splitAccessorsFormats: LayerFieldFormats['splitSeriesAccessors'];
    alreadyFormattedColumns: Record<string, boolean>;
    columnToLabelMap: Record<string, string>;
    multipleLayersWithSplits: boolean;
  },
  titles: LayerAccessorsTitles
) => SeriesName;

type GetColorFn = (
  seriesIdentifier: XYChartSeriesIdentifier,
  config: {
    layer: CommonXYDataLayerConfig;
    colorAssignments: ColorAssignments;
    paletteService: PaletteRegistry;
    getSeriesNameFn: (d: XYChartSeriesIdentifier) => SeriesName;
    syncColors?: boolean;
  },
  uiState?: PersistedState,
  singleTable?: boolean
) => string | null;

type GetPointConfigFn = (config: {
  xAccessor: string | undefined;
  markSizeAccessor: string | undefined;
  showPoints?: boolean;
  pointVisibility?: PointVisibility;
  pointsRadius?: number;
}) => Partial<AreaSeriesStyle['point']>;

type GetLineConfigFn = (config: {
  showLines?: boolean;
  lineWidth?: number;
}) => Partial<AreaSeriesStyle['line']>;

export interface DatatableWithFormatInfo {
  table: Datatable;
  formattedColumns: Record<string, true>;
  /**
   * Inverse map per column to link formatted string to complex values (i.e. `RangeKey`).
   */
  invertedRawValueMap: InvertedRawValueMap;
}

export type DatatablesWithFormatInfo = Record<string, DatatableWithFormatInfo>;

export type FormattedDatatables = Record<string, Datatable>;

const isPrimitive = (value: unknown): boolean => value != null && typeof value !== 'object';

export const getFormattedRow = (
  row: Datatable['rows'][number],
  columns: Datatable['columns'],
  columnsFormatters: Record<string, IFieldFormat>,
  xAccessor: string | undefined,
  splitColumnAccessor: string | undefined,
  splitRowAccessor: string | undefined,
  xScaleType: XScaleType,
  invertedRawValueMap: InvertedRawValueMap
): { row: Datatable['rows'][number]; formattedColumns: Record<string, true> } =>
  columns.reduce(
    (formattedInfo, { id }) => {
      const record = formattedInfo.row[id];
      if (
        record != null &&
        // pre-format values for ordinal x axes because there can only be a single x axis formatter on chart level
        (!isPrimitive(record) ||
          (id === xAccessor && xScaleType === 'ordinal') ||
          id === splitColumnAccessor ||
          id === splitRowAccessor)
      ) {
        const formattedValue = columnsFormatters[id]?.convert(record) ?? '';
        invertedRawValueMap.get(id)?.set(formattedValue, record);
        return {
          row: { ...formattedInfo.row, [id]: formattedValue },
          formattedColumns: { ...formattedInfo.formattedColumns, [id]: true },
        };
      }
      return formattedInfo;
    },
    { row, formattedColumns: {} }
  );

export const getFormattedTable = (
  table: Datatable,
  formatFactory: FormatFactory,
  xAccessor: string | ExpressionValueVisDimension | undefined,
  splitColumnAccessor: string | ExpressionValueVisDimension | undefined,
  splitRowAccessor: string | ExpressionValueVisDimension | undefined,
  accessors: Array<string | ExpressionValueVisDimension>,
  xScaleType: XScaleType
): DatatableWithFormatInfo => {
  const columnsFormatters = table.columns.reduce<Record<string, IFieldFormat>>(
    (formatters, { id, meta }) => {
      const accessor: string | ExpressionValueVisDimension | undefined = accessors.find(
        (a) => getAccessorByDimension(a, table.columns) === id
      );

      return {
        ...formatters,
        [id]: formatFactory(accessor ? getFormat(table.columns, accessor) : meta.params),
      };
    },
    {}
  );

  const invertedRawValueMap: InvertedRawValueMap = new Map(
    table.columns.map((c) => [c.id, new Map<string, RawValue>()])
  );
  const formattedTableInfo: {
    rows: Datatable['rows'];
    formattedColumns: Record<string, true>;
  } = {
    rows: [],
    formattedColumns: {},
  };
  for (const row of table.rows) {
    const formattedRowInfo = getFormattedRow(
      row,
      table.columns,
      columnsFormatters,
      xAccessor ? getAccessorByDimension(xAccessor, table.columns) : undefined,
      splitColumnAccessor ? getAccessorByDimension(splitColumnAccessor, table.columns) : undefined,
      splitRowAccessor ? getAccessorByDimension(splitRowAccessor, table.columns) : undefined,
      xScaleType,
      invertedRawValueMap
    );
    formattedTableInfo.rows.push(formattedRowInfo.row);
    formattedTableInfo.formattedColumns = {
      ...formattedTableInfo.formattedColumns,
      ...formattedRowInfo.formattedColumns,
    };
  }

  return {
    invertedRawValueMap,
    table: { ...table, rows: formattedTableInfo.rows },
    formattedColumns: formattedTableInfo.formattedColumns,
  };
};

export const getFormattedTablesByLayers = (
  layers: CommonXYDataLayerConfig[],
  formatFactory: FormatFactory,
  splitColumnAccessor?: string | ExpressionValueVisDimension,
  splitRowAccessor?: string | ExpressionValueVisDimension
): DatatablesWithFormatInfo =>
  layers.reduce(
    (
      formattedDatatables,
      { layerId, table, xAccessor, splitAccessors = [], accessors, xScaleType }
    ) => ({
      ...formattedDatatables,
      [layerId]: getFormattedTable(
        table,
        formatFactory,
        xAccessor,
        splitColumnAccessor,
        splitRowAccessor,
        [xAccessor, ...splitAccessors, ...accessors, splitColumnAccessor, splitRowAccessor].filter<
          string | ExpressionValueVisDimension
        >((a): a is string | ExpressionValueVisDimension => a !== undefined),
        xScaleType
      ),
    }),
    {}
  );

function getSplitValues(
  splitAccessorsMap: XYChartSeriesIdentifier['splitAccessors'],
  splitAccessors: Array<string | ExpressionValueVisDimension>,
  alreadyFormattedColumns: Record<string, boolean>,
  columns: Datatable['columns'],
  splitAccessorsFormats: LayerFieldFormats['splitSeriesAccessors']
) {
  if (splitAccessorsMap.size < 0) {
    return [];
  }

  return [...splitAccessorsMap].reduce<Array<string | number>>((acc, [splitAccessor, value]) => {
    const split = splitAccessors.find(
      (accessor) => getAccessorByDimension(accessor, columns) === splitAccessor
    );
    if (split) {
      const splitColumnId = getAccessorByDimension(split, columns);
      const splitFormatter = splitAccessorsFormats[splitColumnId].formatter;
      return [
        ...acc,
        alreadyFormattedColumns[splitColumnId] ? value : splitFormatter.convert(value),
      ];
    }

    return acc;
  }, []);
}

export const getSeriesName: GetSeriesNameFn = (
  data,
  {
    splitAccessors,
    accessorsCount,
    columns,
    splitAccessorsFormats,
    alreadyFormattedColumns,
    columnToLabelMap,
    multipleLayersWithSplits,
  },
  titles
) => {
  // For multiple y series, the name of the operation is used on each, either:
  // * Key - Y name
  // * Formatted value - Y name

  const splitValues = getSplitValues(
    data.splitAccessors,
    splitAccessors,
    alreadyFormattedColumns,
    columns,
    splitAccessorsFormats
  );

  const key = data.seriesKeys[data.seriesKeys.length - 1];
  const yAccessorTitle = columnToLabelMap[key] ?? titles?.yTitles?.[key] ?? null;

  if (accessorsCount > 1 || multipleLayersWithSplits) {
    if (splitValues.length === 0) {
      return yAccessorTitle;
    }
    return `${splitValues.join(' - ')}${yAccessorTitle ? ' - ' + yAccessorTitle : ''}`;
  }

  return splitValues.length > 0 ? splitValues.join(' - ') : yAccessorTitle;
};

const getPointConfig: GetPointConfigFn = ({
  markSizeAccessor,
  showPoints,
  pointVisibility,
  pointsRadius,
}) => {
  return {
    visible: pointVisibility ?? (showPoints || markSizeAccessor ? 'always' : 'auto'),
    radius: pointsRadius,
    fill: markSizeAccessor ? ColorVariant.Series : undefined,
  };
};

const getFitLineConfig = () => ({
  visible: true,
  stroke: ColorVariant.Series,
  opacity: 1,
  dash: [],
});

const getLineConfig: GetLineConfigFn = ({ showLines, lineWidth }) => ({
  strokeWidth: lineWidth,
  visible: showLines,
});

const getColor: GetColorFn = (
  series,
  { layer, colorAssignments, paletteService, syncColors, getSeriesNameFn },
  uiState,
  isSingleTable
) => {
  const overwriteColor = getSeriesColor(layer, series.yAccessor as string);
  if (overwriteColor !== null) {
    return overwriteColor;
  }

  const name = getSeriesNameFn(series)?.toString() || '';

  const overwriteColors: Record<string, string> = uiState?.get?.('vis.colors', {}) ?? {};

  if (Object.keys(overwriteColors).includes(name)) {
    return overwriteColors[name];
  }
  const colorAssignment = colorAssignments[layer.palette.name];

  const seriesLayers: SeriesLayer[] = [
    {
      name,
      totalSeriesAtDepth: colorAssignment.totalSeriesCount,
      rankAtDepth: colorAssignment.getRank(isSingleTable ? 'commonLayerId' : layer.layerId, name),
    },
  ];
  return paletteService.get(layer.palette.name).getCategoricalColor(
    seriesLayers,
    {
      maxDepth: 1,
      behindText: false,
      totalSeries: colorAssignment.totalSeriesCount,
      syncColors,
    },
    layer.palette.params
  );
};

const EMPTY_ACCESSOR = '-';
const SPLIT_CHAR = ':';
const SPLIT_Y_ACCESSORS = '|';

export const generateSeriesId = (
  { layerId }: Pick<CommonXYDataLayerConfig, 'layerId'>,
  splitColumnIds: string[],
  accessor?: string,
  xColumnId?: string
) =>
  [layerId, xColumnId ?? EMPTY_ACCESSOR, accessor ?? EMPTY_ACCESSOR, ...splitColumnIds].join(
    SPLIT_CHAR
  );

export const getMetaFromSeriesId = (seriesId: string) => {
  const [layerId, xAccessor, yAccessors, ...splitAccessors] = seriesId.split(SPLIT_CHAR);
  return {
    layerId,
    xAccessor: xAccessor === EMPTY_ACCESSOR ? undefined : xAccessor,
    yAccessors: yAccessors.split(SPLIT_Y_ACCESSORS),
    splitAccessor: splitAccessors[0] === EMPTY_ACCESSOR ? undefined : splitAccessors,
  };
};

export function hasMultipleLayersWithSplits(layers: CommonXYLayerConfig[]) {
  return layers.filter((l) => isDataLayer(l) && (l.splitAccessors?.length || 0) > 0).length > 1;
}

export const getSeriesProps: GetSeriesPropsFn = ({
  layer,
  titles = {},
  accessor,
  chartHasMoreThanOneBarSeries,
  colorAssignments,
  formatFactory,
  columnToLabelMap,
  paletteService,
  palettes,
  syncColors,
  yAxis,
  xAxis,
  timeZone,
  emphasizeFitting,
  fillOpacity,
  formattedDatatableInfo,
  defaultXScaleType,
  fieldFormats,
  uiState,
  allYAccessors,
  singleTable,
  multipleLayersWithSplits,
  isDarkMode,
  pointVisibility,
}): SeriesSpec => {
  const { table, isStacked, markSizeAccessor } = layer;
  const isPercentage = layer.isPercentage;
  let stackMode: StackMode | undefined = isPercentage ? AxisModes.PERCENTAGE : undefined;
  if (yAxis?.mode) {
    stackMode = yAxis?.mode === AxisModes.NORMAL ? undefined : yAxis?.mode;
  }
  const yScaleType = yAxis?.scaleType || ScaleType.Linear;
  const isBarChart = layer.seriesType === SeriesTypes.BAR;
  const xColumnId =
    layer.xAccessor !== undefined
      ? getAccessorByDimension(layer.xAccessor, table.columns)
      : undefined;
  const splitColumnIds =
    layer.splitAccessors?.map((splitAccessor) => {
      return getAccessorByDimension(splitAccessor, table.columns);
    }) || [];
  const enableHistogramMode =
    layer.isHistogram &&
    (isStacked || !splitColumnIds.length) &&
    (isStacked || !isBarChart || !chartHasMoreThanOneBarSeries);

  const formatter = table?.columns.find(
    (column) => column.id === (Array.isArray(accessor) ? accessor[0] : accessor)
  )?.meta?.params;

  const markSizeColumnId = markSizeAccessor
    ? getAccessorByDimension(markSizeAccessor, table.columns)
    : undefined;

  const markFormatter = formatFactory(
    markSizeAccessor ? getFormat(table.columns, markSizeAccessor) : undefined
  );

  const { table: formattedTable, formattedColumns, invertedRawValueMap } = formattedDatatableInfo;

  // For date histogram chart type, we're getting the rows that represent intervals without data.
  // To not display them in the legend, they need to be filtered out.
  let rows = formattedTable.rows.filter(
    (row) =>
      !(xColumnId && row[xColumnId] === undefined) &&
      !(
        splitColumnIds.some((splitColumnId) => row[splitColumnId] === undefined) &&
        (Array.isArray(accessor)
          ? accessor.some((a) => row[a] === undefined)
          : row[accessor] === undefined)
      )
  );

  const emptyX: Record<string, string> = {
    unifiedX: '',
  };

  if (!xColumnId) {
    rows = rows.map((row) => ({
      ...row,
      ...emptyX,
    }));
  }

  const getSeriesNameFn = (d: XYChartSeriesIdentifier) => {
    return getSeriesName(
      d,
      {
        splitAccessors: layer.splitAccessors || [],
        accessorsCount: singleTable ? allYAccessors.length : layer.accessors.length,
        alreadyFormattedColumns: formattedColumns,
        columns: formattedTable.columns,
        splitAccessorsFormats: fieldFormats[layer.layerId].splitSeriesAccessors,
        columnToLabelMap,
        multipleLayersWithSplits,
      },
      titles
    );
  };

  const colorAccessorFn: SeriesColorAccessorFn =
    // if colorMapping exist then we can apply it, if not let's use the legacy coloring method
    layer.colorMapping && splitColumnIds.length > 0
      ? getColorSeriesAccessorFn(
          JSON.parse(layer.colorMapping), // the color mapping is at this point just a stringified JSON
          invertedRawValueMap,
          palettes,
          isDarkMode,
          {
            type: 'categories',
            categories: getColorCategories(table.rows, splitColumnIds[0]),
          },
          splitColumnIds[0]
        )
      : (series) =>
          getColor(
            series,
            {
              layer,
              colorAssignments,
              paletteService,
              getSeriesNameFn,
              syncColors,
            },
            uiState,
            singleTable
          );

  return {
    splitSeriesAccessors: splitColumnIds.length ? splitColumnIds : [],
    stackAccessors: isStacked ? [xColumnId || 'unifiedX'] : [],
    id: generateSeriesId(
      layer,
      splitColumnIds.length ? splitColumnIds : [EMPTY_ACCESSOR],
      Array.isArray(accessor) ? accessor.join(SPLIT_Y_ACCESSORS) : accessor,
      xColumnId
    ),
    xAccessor: xColumnId || 'unifiedX',
    yAccessors: Array.isArray(accessor) ? accessor : [accessor],
    markSizeAccessor: markSizeColumnId,
    markFormat: (value) => markFormatter.convert(value),
    data: rows,
    xScaleType: xColumnId ? layer.xScaleType ?? defaultXScaleType : 'ordinal',
    yScaleType:
      formatter?.id === 'bytes' && yScaleType === ScaleType.Linear
        ? ScaleType.LinearBinary
        : yScaleType,
    color: colorAccessorFn,
    groupId: yAxis?.groupId,
    enableHistogramMode,
    stackMode,
    timeZone,
    areaSeriesStyle: {
      point: getPointConfig({
        xAccessor: xColumnId,
        markSizeAccessor: markSizeColumnId,
        showPoints: layer.showPoints,
        pointVisibility,
        pointsRadius: layer.pointsRadius,
      }),
      ...(fillOpacity && { area: { opacity: fillOpacity } }),
      ...(emphasizeFitting && {
        fit: { area: { opacity: fillOpacity || 0.5 }, line: getFitLineConfig() },
      }),
      line: getLineConfig({
        showLines: layer.showLines,
        lineWidth: layer.lineWidth,
      }),
    },
    lineSeriesStyle: {
      point: getPointConfig({
        xAccessor: xColumnId,
        markSizeAccessor: markSizeColumnId,
        showPoints: layer.showPoints,
        pointVisibility,
        pointsRadius: layer.pointsRadius,
      }),
      ...(emphasizeFitting && { fit: { line: getFitLineConfig() } }),
      line: getLineConfig({ lineWidth: layer.lineWidth, showLines: layer.showLines }),
    },
    name(d) {
      return getSeriesNameFn(d);
    },
    yNice: Boolean(yAxis?.extent?.niceValues),
    xNice: Boolean(xAxis?.extent?.niceValues),
  };
};
