using Microsoft.AspNetCore.Components;

namespace MangaPanel.Client.Layout;

public class MenuData
{
    public string Label { get; set; } = string.Empty;
    public string Href { get; set; } = string.Empty;
    public RenderFragment? Icon { get; set; }
}