import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { YandexDevice, FavoriteProperty, FavoritePropertyKey } from '../types';
import { getIconForDevice, localizeUnit } from '../constants';
import { Loader2, Power, Star, Settings, X } from 'lucide-react';

interface DeviceCardProps {
  device: YandexDevice;
  onToggle: (id: string, currentState: boolean) => Promise<void>;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onOpenSettings?: (device: YandexDevice) => void;
  onOpenHistory?: (device: YandexDevice) => void;
  onTogglePropertyFavorite?: (deviceId: string, property: FavoritePropertyKey) => void;
  favoriteProperties?: FavoriteProperty[];
  singleProperty?: 'temperature' | 'humidity';
  compact?: boolean;
  roomName?: string;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  onToggle,
  isFavorite,
  onToggleFavorite,
  onOpenSettings,
  onOpenHistory,
  onTogglePropertyFavorite,
  favoriteProperties,
  singleProperty,
  compact,
  roomName,
}) => {
  const [loading, setLoading] = useState(false);
  const [showFavMenu, setShowFavMenu] = useState(false);
  const [favMenuPos, setFavMenuPos] = useState<{top: number; left: number} | null>(null);
  const favMenuRef = useRef<HTMLDivElement>(null);
  const starBtnRef = useRef<HTMLDivElement>(null);

  // Close fav menu on outside click
  useEffect(() => {
    if (!showFavMenu) return;
    const handler = (e: MouseEvent) => {
      if (favMenuRef.current && !favMenuRef.current.contains(e.target as Node)) {
        setShowFavMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFavMenu]);

  // Проверяем, является ли устройство кондиционером или термостатом
  const isThermostat = device.type === 'devices.types.thermostat.ac' || device.type === 'devices.types.thermostat';

  // Проверяем, является ли устройство лампочкой
  const isLight = device.type.startsWith('devices.types.light');

  // Проверяем, является ли устройство вентилятором
  const isFan = device.type === 'devices.types.ventilation.fan';

  // Find the on_off capability
  const onOffCapability = device.capabilities.find(c => c.type === 'devices.capabilities.on_off');

  const isToggleable = !!onOffCapability;
  const isOn = onOffCapability?.state?.value === true ||
                device.type.toLowerCase().includes('smart_speaker') ||
                device.type.toLowerCase().includes('hub') ||
                device.type.toLowerCase().includes('other');

  // Sensor detection
  const sensorProperty = (device.properties ?? []).find(prop => {
    const anyProp = prop as any;
    const type: string | undefined = anyProp?.type;
    const instance: string | undefined = anyProp?.parameters?.instance ?? anyProp?.state?.instance;
    return (
      typeof type === 'string' &&
      type.includes('devices.properties') &&
      typeof instance === 'string'
    );
  }) as any | undefined;

  // Extract temperature and humidity properties separately
  const temperatureProperty = (device.properties ?? []).find(prop => {
    const anyProp = prop as any;
    const type: string | undefined = anyProp?.type;
    const instance: string | undefined = anyProp?.parameters?.instance ?? anyProp?.state?.instance;
    return type === 'devices.properties.float' && instance === 'temperature';
  }) as any | undefined;

  const humidityProperty = (device.properties ?? []).find(prop => {
    const anyProp = prop as any;
    const type: string | undefined = anyProp?.type;
    const instance: string | undefined = anyProp?.parameters?.instance ?? anyProp?.state?.instance;
    return type === 'devices.properties.float' && instance === 'humidity';
  }) as any | undefined;

  const temperatureValue: number | null = temperatureProperty?.state?.value ?? null;
  const temperatureUnit = temperatureProperty?.parameters?.unit
    ? localizeUnit(temperatureProperty.parameters.unit)
    : temperatureProperty?.state?.unit
      ? localizeUnit(temperatureProperty.state.unit)
      : ' °C';

  const humidityValue: number | null = humidityProperty?.state?.value ?? null;
  const humidityUnit = humidityProperty?.parameters?.unit
    ? localizeUnit(humidityProperty.parameters.unit)
    : humidityProperty?.state?.unit
      ? localizeUnit(humidityProperty.state.unit)
      : ' %';

  const isSensor = !isToggleable && !!sensorProperty;

  const sensorInstance: string | undefined =
    sensorProperty?.parameters?.instance ?? sensorProperty?.state?.instance;
  const rawSensorValue: unknown = sensorProperty?.state?.value;
  const rawSensorUnit: string | undefined =
    sensorProperty?.parameters?.unit ?? sensorProperty?.state?.unit;
  const propertyType: string | undefined = sensorProperty?.type;

  const isEventProperty = propertyType === 'devices.properties.event';

  let localizedEventValue: string | null = null;
  if (isEventProperty && typeof rawSensorValue === 'string') {
    const events = (sensorProperty as any)?.parameters?.events as Array<{ value: string; name: string }> | undefined;
    if (events && Array.isArray(events)) {
      const matchingEvent = events.find(event => event.value === rawSensorValue);
      if (matchingEvent) {
        localizedEventValue = matchingEvent.name;
      }
    }
    if (!localizedEventValue) {
      localizedEventValue = rawSensorValue;
    }
  }

  const localizedUnit = localizeUnit(rawSensorUnit);

  const resolvedUnit =
    localizedUnit ||
    (sensorInstance === 'humidity' ? ' %' : sensorInstance === 'temperature' ? ' °C' : '');

  const formattedSensorValue = isEventProperty && localizedEventValue
    ? localizedEventValue
    : typeof rawSensorValue === 'number'
    ? `${rawSensorValue}${resolvedUnit ?? ''}`
    : typeof rawSensorValue === 'string'
    ? `${rawSensorValue}${resolvedUnit ?? ''}`
    : null;

  // Determine if sensor has both temp and humidity (for selective favorites)
  const hasBothTempHumidity = temperatureValue !== null && humidityValue !== null;
  const showFavMenuOption = isSensor && hasBothTempHumidity && !!onTogglePropertyFavorite && !compact;

  const handleClick = async () => {
    if (!isToggleable || loading) return;

    setLoading(true);
    try {
      await onToggle(device.id, isOn);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if ((isThermostat || isLight || isFan) && onOpenSettings) {
      e.preventDefault();
      e.stopPropagation();
      onOpenSettings(device);
    }
  };

  const icon = getIconForDevice(device.type);

  if (compact) {
    const favoriteBtn = (
      <div
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(device.id); }}
        className="shrink-0 cursor-pointer text-yellow-500 dark:text-accent"
        title="Убрать из избранного"
      >
        <Star className="w-4 h-4 fill-current" />
      </div>
    );

    // Sensor compact: name + room on left, temperature/humidity stacked on right
    if (isSensor) {
      // If singleProperty, show only one metric
      if (singleProperty) {
        return (
          <div
            className="flex items-center justify-between gap-3 px-3 py-2.5 bg-white dark:bg-surface border border-gray-200 dark:border-white/5 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
            onClick={() => onOpenHistory?.(device)}
          >
            <div className="flex items-center gap-2 min-w-0">
              {favoriteBtn}
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{device.name}</p>
                {roomName && <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{roomName}</p>}
              </div>
            </div>
            <div className="text-right shrink-0 text-xs text-slate-600 dark:text-slate-300">
              {singleProperty === 'temperature' && temperatureValue !== null && (
                <p>Температура: <span className="font-semibold">{temperatureValue}{temperatureUnit}</span></p>
              )}
              {singleProperty === 'humidity' && humidityValue !== null && (
                <p>Влажность: <span className="font-semibold">{humidityValue}{humidityUnit}</span></p>
              )}
            </div>
          </div>
        );
      }

      return (
        <div
          className="flex items-center justify-between gap-3 px-3 py-2.5 bg-white dark:bg-surface border border-gray-200 dark:border-white/5 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
          onClick={() => onOpenHistory?.(device)}
        >
          <div className="flex items-center gap-2 min-w-0">
            {favoriteBtn}
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{device.name}</p>
              {roomName && <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{roomName}</p>}
            </div>
          </div>
          <div className="text-right shrink-0 text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
            {temperatureValue !== null && (
              <p>Температура: <span className="font-semibold">{temperatureValue}{temperatureUnit}</span></p>
            )}
            {humidityValue !== null && (
              <p>Влажность: <span className="font-semibold">{humidityValue}{humidityUnit}</span></p>
            )}
            {temperatureValue === null && humidityValue === null && formattedSensorValue && (
              <p className="font-semibold">{formattedSensorValue}</p>
            )}
          </div>
        </div>
      );
    }

    // Device compact: clickable tile, color highlight, вкл/выкл status
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border transition-all duration-200 text-left
          ${isOn
            ? 'bg-purple-50 dark:bg-primary/20 border-purple-300 dark:border-primary/50'
            : 'bg-white dark:bg-surface border-gray-200 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-slate-700/50'
          }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(device.id); }}
            className="shrink-0 cursor-pointer text-yellow-500 dark:text-accent"
            title="Убрать из избранного"
          >
            <Star className="w-4 h-4 fill-current" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{device.name}</p>
            {roomName && <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{roomName}</p>}
          </div>
        </div>
        <div className={`shrink-0 w-8 h-4 rounded-full relative transition-colors duration-300 ${loading ? 'opacity-50' : ''} ${isOn ? 'bg-purple-500 dark:bg-primary' : 'bg-gray-300 dark:bg-slate-600'}`}>
          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-300 ${isOn ? 'left-[1.1rem]' : 'left-0.5'}`} />
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      disabled={loading}
      className={`
        relative overflow-hidden group
        flex flex-col p-3 gap-2
        border rounded-xl text-left
        transition-all duration-200 ease-out
        w-full
        ${isToggleable ? 'cursor-pointer hover:scale-[1.02]' : 'cursor-default'}
        ${
          isToggleable
            ? isOn
              ? 'bg-purple-50 dark:bg-primary/20 border-purple-300 dark:border-primary/50 shadow-purple-200 dark:shadow-[0_0_15px_rgba(59,130,246,0.15)]'
              : 'bg-white dark:bg-surface border-gray-200 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-slate-700/50'
            : 'bg-white dark:bg-surface border-gray-200 dark:border-white/5'
        }
      `}
    >

	<div className="absolute top-3 right-3 z-20 flex items-center gap-2">
      {/* Settings button for thermostat, light and fan */}
      {(isThermostat || isLight || isFan) && onOpenSettings && (
        <div
          onClick={(e) => {
              e.stopPropagation();
              onOpenSettings(device);
          }}
          className="p-1 rounded-full transition-all duration-200 cursor-pointer text-gray-400 dark:text-slate-500 opacity-50 hover:opacity-100 hover:text-slate-900 dark:hover:text-white"
          title={isThermostat ? "Открыть настройки климата" : isFan ? "Открыть настройки вентилятора" : "Открыть настройки яркости"}
        >
          <Settings className="w-4 h-4" />
        </div>
      )}

      {/* Favorite star */}
      <div ref={starBtnRef}>
        <div
            onClick={(e) => {
                e.stopPropagation();
                if (showFavMenuOption) {
                  if (!showFavMenu) {
                    const rect = starBtnRef.current?.getBoundingClientRect();
                    if (rect) setFavMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
                  }
                  setShowFavMenu(prev => !prev);
                } else {
                  onToggleFavorite(device.id);
                }
            }}
            className={`
                p-1 rounded-full transition-all duration-200 cursor-pointer
                ${isFavorite ? 'text-yellow-500 dark:text-accent bg-white/80 dark:bg-surface/80 hover:bg-white dark:hover:bg-surface' : 'text-gray-400 dark:text-slate-500 hover:text-yellow-500 dark:hover:text-accent opacity-0 group-hover:opacity-100'}
            `}
            title={showFavMenuOption ? 'Добавить в избранное' : isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
        >
            <Star className="w-4 h-4 fill-current" />
        </div>
      </div>
    </div>

      <div className="flex items-start justify-between w-full">
        <div
          className={`
            p-2 rounded-full transition-colors duration-300
            ${
              isToggleable
                ? isOn
                  ? 'bg-purple-600 dark:bg-primary text-white'
                  : 'bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                : isSensor
                  ? 'bg-purple-50 dark:bg-primary text-purple-600 dark:text-slate-100'
                  : isOn
                    ? 'bg-purple-50 dark:bg-primary text-purple-600 dark:text-slate-100'
                    : 'bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
            }
        `}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
              className: 'w-4 h-4',
            })
          )}
        </div>
      </div>

      <div className="mt-1">
        <p className="font-medium text-slate-900 dark:text-slate-100 line-clamp-1 text-sm">
          {device.name}
        </p>
        <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 space-y-1">
          {loading ? (
            <p>Обновление...</p>
          ) : temperatureValue !== null || humidityValue !== null ? (
            <>
              {temperatureValue !== null && (
                <p>Температура: <span className="font-medium text-slate-700 dark:text-slate-300">{temperatureValue}{temperatureUnit}</span></p>
              )}
              {humidityValue !== null && (
                <p>Влажность: <span className="font-medium text-slate-700 dark:text-slate-300">{humidityValue}{humidityUnit}</span></p>
              )}
            </>
          ) : (
            <p>
              {isSensor && formattedSensorValue
                ? formattedSensorValue
                : isOn
                  ? 'Включено'
                  : 'Отключено'}
            </p>
          )}
        </div>
      </div>

	  <div className="flex justify-end">
        {isToggleable && (
             <div className={`
                w-8 h-4 rounded-full relative transition-colors duration-300
                ${isOn ? 'bg-purple-400 dark:bg-primary/50' : 'bg-gray-300 dark:bg-slate-700'}
             `}>
                 <div className={`
                    absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-300
                    ${isOn ? 'left-4.5' : 'left-0.5'}
                 `} style={{ left: isOn ? '1.1rem' : '0.15rem' }}></div>
             </div>
        )}
      </div>
    </button>
    {showFavMenu && favMenuPos && createPortal(
      <div
        ref={favMenuRef}
        className="fixed z-[200] bg-white dark:bg-surface border border-gray-200 dark:border-white/10 rounded-xl shadow-xl p-1 min-w-[160px]"
        style={{ top: favMenuPos.top, left: favMenuPos.left }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-2 py-1 mb-1">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Добавить в избранное</span>
          <button onClick={() => setShowFavMenu(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
            <X className="w-3 h-3" />
          </button>
        </div>
        <button onClick={() => { onToggleFavorite(device.id); setShowFavMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200">Целиком</button>
        <button onClick={() => { onTogglePropertyFavorite!(device.id, 'temperature'); setShowFavMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200">Температура</button>
        <button onClick={() => { onTogglePropertyFavorite!(device.id, 'humidity'); setShowFavMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200">Влажность</button>
      </div>,
      document.body
    )}
  );
};
