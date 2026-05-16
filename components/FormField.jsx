'use client';

export default function FormField({ label, type = 'text', placeholder, value, onChange, options, rows, required, disabled }) {
  const baseClasses = "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent hover:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-300">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>
      
      {type === 'textarea' ? (
        <textarea
          rows={rows || 4}
          placeholder={placeholder}
          value={value}
          onChange={onChange || (() => {})}
          disabled={disabled}
          className={baseClasses}
        />
      ) : type === 'select' ? (
        <select
          value={value}
          onChange={onChange || (() => {})}
          disabled={disabled}
          className={baseClasses}
        >
          <option value="">Select an option</option>
          {options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange || (() => {})}
          disabled={disabled}
          className={baseClasses}
        />
      )}
    </div>
  );
}