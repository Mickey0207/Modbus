import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { ChevronDown, Search, Check, X } from 'lucide-react';

const SearchableSelect = ({ 
  options = [], 
  value = '', 
  onChange = () => {}, 
  placeholder = '請選擇...',
  searchPlaceholder = '搜尋選項...',
  className = '',
  disabled = false,
  allowClear = false,
  multiple = false,
  maxDisplayOptions = 10,
  createNewOption = null // 函數，允許創建新選項
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredOptions, setFilteredOptions] = useState(options);
  const [selectedValues, setSelectedValues] = useState(multiple ? (Array.isArray(value) ? value : []) : [value]);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // 處理選項格式化
  const formatOptions = (opts) => {
    return opts.map(opt => {
      if (typeof opt === 'string') {
        return { value: opt, label: opt };
      }
      return opt;
    });
  };

  const formattedOptions = formatOptions(options);

  useEffect(() => {
    const filtered = formattedOptions.filter(option =>
      option.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      option.value.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredOptions(filtered);
  }, [searchTerm, options]);

  useEffect(() => {
    if (multiple) {
      setSelectedValues(Array.isArray(value) ? value : []);
    } else {
      setSelectedValues([value]);
    }
  }, [value, multiple]);

  // 計算下拉選單位置
  const updateDropdownPosition = () => {
    if (dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const dropdownHeight = 300; // 估計下拉選單高度
      
      let top = rect.bottom + 2;
      let left = rect.left;
      
      // 檢查是否會超出視窗底部，如果會則顯示在按鈕上方
      if (top + dropdownHeight > viewportHeight) {
        top = rect.top - dropdownHeight - 2;
      }
      
      // 檢查是否會超出視窗右邊，如果會則向左調整
      if (left + rect.width > window.innerWidth) {
        left = window.innerWidth - rect.width - 10;
      }
      
      // 確保不會超出視窗左邊
      if (left < 10) {
        left = 10;
      }
      
      setDropdownPosition({
        top: Math.max(top, 10), // 確保不會超出視窗頂部
        left: left,
        width: rect.width
      });
    }
  };

  // 處理打開/關閉下拉選單
  const handleToggle = () => {
    if (!disabled) {
      if (!isOpen) {
        setIsOpen(true);
        // 使用 requestAnimationFrame 確保在下一個渲染週期計算位置
        requestAnimationFrame(() => {
          updateDropdownPosition();
        });
      } else {
        setIsOpen(false);
      }
    }
  };

  // GSAP 動畫和位置更新
  useEffect(() => {
    if (isOpen && listRef.current) {
      // 確保位置正確
      updateDropdownPosition();
      
      gsap.fromTo(listRef.current, 
        {
          opacity: 0,
          y: -10,
          scale: 0.95
        },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.2,
          ease: 'power2.out'
        }
      );
    }
  }, [isOpen]);

  // 點擊外部關閉
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target) &&
          listRef.current && !listRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    const handleScroll = () => {
      if (isOpen) {
        updateDropdownPosition();
      }
    };

    const handleResize = () => {
      if (isOpen) {
        updateDropdownPosition();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('scroll', handleScroll, true); // 捕獲所有滾動事件
      window.addEventListener('scroll', handleScroll);
      window.addEventListener('resize', handleResize);
      
      // 初始化位置
      requestAnimationFrame(updateDropdownPosition);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  const handleSelect = (option) => {
    if (multiple) {
      const newValues = selectedValues.includes(option.value)
        ? selectedValues.filter(v => v !== option.value)
        : [...selectedValues, option.value];
      
      setSelectedValues(newValues);
      onChange(newValues);
    } else {
      setSelectedValues([option.value]);
      onChange(option.value);
      setIsOpen(false);
      setSearchTerm('');
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    if (multiple) {
      setSelectedValues([]);
      onChange([]);
    } else {
      setSelectedValues(['']);
      onChange('');
    }
  };

  const handleCreateNew = () => {
    if (createNewOption && searchTerm.trim()) {
      const newOption = createNewOption(searchTerm.trim());
      if (newOption) {
        handleSelect(newOption);
        setSearchTerm('');
      }
    }
  };

  const getDisplayValue = () => {
    if (multiple) {
      if (selectedValues.length === 0) return placeholder;
      if (selectedValues.length === 1) {
        const option = formattedOptions.find(opt => opt.value === selectedValues[0]);
        return option ? option.label : selectedValues[0];
      }
      return `已選擇 ${selectedValues.length} 項`;
    } else {
      if (!selectedValues[0]) return placeholder;
      const option = formattedOptions.find(opt => opt.value === selectedValues[0]);
      return option ? option.label : selectedValues[0];
    }
  };

  const isSelected = (optionValue) => selectedValues.includes(optionValue);

  const showCreateOption = createNewOption && searchTerm.trim() && 
    !filteredOptions.some(opt => opt.label.toLowerCase() === searchTerm.toLowerCase());

  return (
    <div 
      ref={dropdownRef} 
      className={`relative ${className}`}
      style={{ zIndex: isOpen ? 9999 : 'auto' }}
    >
      {/* 主要選擇框 */}
      <div
        onClick={handleToggle}
        className={`
          relative w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg 
          cursor-pointer transition-all duration-200 font-chinese
          glass-light hover:border-button-300 hover:shadow-md
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${isOpen ? 'border-button-500 shadow-lg ring-2 ring-button-100' : ''}
        `}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 truncate">
            {!multiple && selectedValues[0] && (() => {
              const opt = formattedOptions.find(o => o.value === selectedValues[0]);
              return opt?.icon ? (
                <span className="inline-flex items-center justify-center w-4 h-4">
                  {opt.icon}
                </span>
              ) : null;
            })()}
            <span className={`truncate ${!selectedValues[0] && !multiple ? 'text-gray-500' : 'text-gray-900'}`}>
              {getDisplayValue()}
            </span>
          </div>
          
          <div className="flex items-center gap-2 ml-2">
            {allowClear && (selectedValues[0] || (multiple && selectedValues.length > 0)) && (
              <button
                onClick={handleClear}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                type="button"
              >
                <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
            
            <ChevronDown 
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                isOpen ? 'transform rotate-180' : ''
              }`} 
            />
          </div>
        </div>

        {/* 多選標籤顯示 */}
        {multiple && selectedValues.length > 1 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {selectedValues.slice(0, 3).map(val => {
              const option = formattedOptions.find(opt => opt.value === val);
              return (
                <span
                  key={val}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-button-100 text-button-800 text-xs rounded-full"
                >
                  {option ? option.label : val}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect({ value: val });
                    }}
                    className="hover:bg-button-200 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
            {selectedValues.length > 3 && (
              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                +{selectedValues.length - 3} 更多
              </span>
            )}
          </div>
        )}
      </div>

      {/* 下拉選項列表 - 使用 Portal 渲染到 body */}
      {isOpen && createPortal(
        <div
          ref={listRef}
          className="fixed z-[200000] glass-dropdown"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
            zIndex: 200000,
            minWidth: '200px'
          }}
        >
          {/* 搜尋框 */}
          <div className="glass-dropdown-search">
            <div className="relative">
              <Search
                className="absolute text-gray-500 w-4 h-4"
                style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              />
              <input
                ref={inputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={searchPlaceholder}
                className="font-chinese"
                autoFocus
              />
            </div>
          </div>

          {/* 選項列表 */}
          <div className="max-h-60 overflow-y-auto">
            {/* 創建新選項 */}
            {showCreateOption && (
              <button
                onClick={handleCreateNew}
                className="glass-dropdown-create font-chinese group"
              >
                <div 
                  className="w-4 h-4 border-2 rounded-full flex items-center justify-center transition-colors"
                  style={{ borderColor: 'var(--brand-primary)' }}
                >
                  <div 
                    className="w-1 h-1 rounded-full transition-colors"
                    style={{ backgroundColor: 'var(--brand-primary)' }}
                  ></div>
                </div>
                <span className="group-hover:text-orange-800">創建 "{searchTerm}"</span>
              </button>
            )}

            {filteredOptions.slice(0, maxDisplayOptions).map((option) => (
              <button
                key={option.value}
                onClick={() => handleSelect(option)}
                className={`glass-dropdown-option font-chinese ${isSelected(option.value) ? 'selected' : ''}`}
              >
                <span className="truncate flex items-center gap-2">
                  {option.icon && (
                    <span className="inline-flex items-center justify-center w-4 h-4">
                      {option.icon}
                    </span>
                  )}
                  <span className="truncate">{option.label}</span>
                </span>
                {isSelected(option.value) && (
                  <Check className="w-4 h-4 flex-shrink-0 ml-2" style={{ color: 'var(--brand-primary)' }} />
                )}
              </button>
            ))}

            {filteredOptions.length === 0 && !showCreateOption && (
              <div className="glass-dropdown-empty font-chinese">
                <Search className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm">沒有找到符合的選項</p>
              </div>
            )}

            {filteredOptions.length > maxDisplayOptions && (
              <div className="glass-dropdown-more font-chinese">
                還有 {filteredOptions.length - maxDisplayOptions} 個選項...
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default SearchableSelect;