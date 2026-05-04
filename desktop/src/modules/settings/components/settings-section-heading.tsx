type SettingsSectionHeadingProps = {
  children: string
}

function SettingsSectionHeading({ children }: SettingsSectionHeadingProps) {
  return (
    <h3 className="mt-6 mb-3 text-sm font-medium text-foreground first:mt-0">
      {children}
    </h3>
  )
}

export { SettingsSectionHeading }
