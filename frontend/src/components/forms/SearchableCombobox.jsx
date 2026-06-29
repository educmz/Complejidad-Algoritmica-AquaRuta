import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

function isActive(value) {
  return Boolean(value && value !== "todos");
}

function normalizeSearchText(value, formatLabel) {
  return formatLabel(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export default function SearchableCombobox({
  label,
  value,
  allLabel,
  options,
  onChange,
  formatLabel = (item) => String(item ?? ""),
  allowClear = true,
  includeAllOption = true,
  disabled = false,
}) {
  const listId = useId();
  const rootRef = useRef(null);
  const controlRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuRect, setMenuRect] = useState(null);

  const allOptions = useMemo(
    () => (includeAllOption ? [{ value: "todos", label: allLabel }, ...options] : options),
    [allLabel, includeAllOption, options]
  );
  const visibleOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query, formatLabel);
    if (!normalizedQuery) return allOptions;
    return allOptions.filter((option) =>
      normalizeSearchText(option.label, formatLabel).includes(normalizedQuery)
    );
  }, [allOptions, formatLabel, query]);

  function selectOption(option) {
    if (!option) return;
    if (disabled) return;
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function updateMenuRect() {
    const rect = controlRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 12;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const placeAbove = availableBelow < 180 && availableAbove > availableBelow;
    const maxHeight = Math.max(160, Math.min(320, placeAbove ? availableAbove : availableBelow));
    setMenuRect({
      left: Math.max(viewportPadding, rect.left),
      top: placeAbove ? Math.max(viewportPadding, rect.top - maxHeight - 6) : rect.bottom + 6,
      width: Math.min(rect.width, window.innerWidth - viewportPadding * 2),
      maxHeight,
    });
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    updateMenuRect();
    return undefined;
  }, [open, visibleOptions.length]);

  useEffect(() => {
    if (!open) return undefined;
    const handleUpdate = () => updateMenuRect();
    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      if (event.target?.closest?.(`[data-combobox-menu="${listId}"]`)) return;
      setOpen(false);
    };
    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [listId, open]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (disabled) return;
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, visibleOptions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (disabled) return;
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && !disabled) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex]);
    }
  }

  return (
    <label className="control-group dashboard-combobox" ref={rootRef}>
      <span className="control-label">{label}</span>
      <div
        className="dashboard-combobox-control"
        ref={controlRef}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget) &&
            !event.relatedTarget?.closest?.(`[data-combobox-menu="${listId}"]`)
          ) {
            setOpen(false);
          }
        }}
      >
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="control-select dashboard-combobox-input"
          disabled={disabled}
          value={open ? query : formatLabel(selectedOption?.label || allLabel)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            if (disabled) return;
            setQuery("");
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {allowClear && !disabled && isActive(value) && (
          <button
            type="button"
            className="dashboard-combobox-clear"
            aria-label={`Limpiar ${label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectOption(allOptions[0])}
          >
            x
          </button>
        )}
        <button
          type="button"
          className="dashboard-combobox-toggle"
          aria-label={`Abrir ${label}`}
          aria-expanded={open}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (disabled) return;
            setActiveIndex(0);
            setOpen((current) => !current);
          }}
        >
          ▾
        </button>
        {open && menuRect && createPortal(
          <div
            className="dashboard-combobox-menu dashboard-combobox-menu-portal"
            data-combobox-menu={listId}
            id={listId}
            role="listbox"
            style={{
              left: `${menuRect.left}px`,
              maxHeight: `${menuRect.maxHeight}px`,
              top: `${menuRect.top}px`,
              width: `${menuRect.width}px`,
            }}
          >
            {visibleOptions.length ? (
              visibleOptions.map((option, index) => (
                <button
                  type="button"
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={index === activeIndex ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  {formatLabel(option.label)}
                </button>
              ))
            ) : (
              <span className="dashboard-combobox-empty">Sin coincidencias</span>
            )}
          </div>,
          document.body
        )}
      </div>
    </label>
  );
}
