package ai.minepilot.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Bundle;
import android.view.View;

/**
 * Packet-derived gameplay analytics, never a rendered game view or pathfinder.
 * Radar: X east/right, Z south/down, centered on the bot, fixed +/-24 blocks.
 * Unknown readings are shown as unknown rather than a fabricated zero.
 */
public final class LifeAnalyticsView extends View {
    private static final int BG = 0xff111b2a;
    private static final int GRID = 0xff304057;
    private static final int TEXT = 0xffe8f2ff;
    private static final int MUTED = 0xff9fb0ca;
    private static final int GREEN = 0xff65e4ad;
    private static final int RED = 0xffff7585;
    private static final int GOLD = 0xffffc07a;
    private static final float RANGE = 24f;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private float[] entities = new float[0]; // dx, dz, hostile(1/0), player(1/0)
    private String state = "awaiting_world";
    private String intent = "observe";
    private int health = -1, hunger = -1, threats = 0;
    private int walkable = 0, hazards = 0, blocked = 0, unknown = 25;
    private boolean connected = false;

    public LifeAnalyticsView(Context context) { super(context); }
    @Override protected void onMeasure(int w, int h) {
        int proposed = (int)(350 * getResources().getDisplayMetrics().density);
        setMeasuredDimension(resolveSize(proposed,w), resolveSize(proposed,h));
    }
    public void update(Bundle data) {
        connected = "spawned".equals(data.getString("phase", ""));
        if (!connected || !data.getBoolean("life_available",false)) {
            entities = new float[0]; state = "awaiting_world"; intent = "observe";
            health = -1; hunger = -1; threats = 0;
            walkable = hazards = blocked = 0; unknown = 25;
        } else {
            state = data.getString("life_state", "awaiting_world");
            intent = data.getString("life_intent", "observe");
            health = data.getInt("life_health", -1);
            hunger = data.getInt("life_hunger", -1);
            threats = data.getInt("life_hostiles", 0);
            walkable = data.getInt("life_walkable", 0);
            hazards = data.getInt("life_hazard", 0);
            blocked = data.getInt("life_blocked", 0);
            unknown = data.getInt("life_unknown", 25);
            float[] observed = data.getFloatArray("life_entity_vectors");
            entities = observed == null || observed.length > 96 || observed.length % 4 != 0
                    ? new float[0] : observed.clone();
        }
        invalidate();
    }
    private void fill(Canvas c, int color, float l,float t,float r,float b,float radius) {
        paint.setColor(color); paint.setStyle(Paint.Style.FILL);
        c.drawRoundRect(l,t,r,b,radius,radius,paint);
    }
    private void label(Canvas c,String text,float x,float y,int color,float size) {
        paint.setStyle(Paint.Style.FILL);paint.setColor(color);paint.setTextSize(size);
        paint.setTypeface(android.graphics.Typeface.create("sans-serif",android.graphics.Typeface.NORMAL));
        c.drawText(text,x,y,paint);
    }
    private void bar(Canvas c,String name,int value,float x,float y,float width,int color) {
        label(c,name + (value<0 ? " —" : " "+value+"/20"),x,y,TEXT,13);
        fill(c,GRID,x,y+9,x+width,y+19,5);
        if (value>=0) fill(c,color,x,y+9,x+width*Math.max(0,Math.min(20,value))/20f,y+19,5);
    }
    @Override protected void onDraw(Canvas c) {
        super.onDraw(c);
        final float scale=getResources().getDisplayMetrics().density;
        c.save();
        c.scale(scale,scale);
        float width=getWidth()/scale;
        float height=getHeight()/scale;
        fill(c,BG,0,0,width,height,14);
        label(c,"LIFE ANALYTICS  ·  PACKET OBSERVATIONS",14,23,GREEN,12);
        label(c,"State: "+state.replace('_',' '),14,44,TEXT,14);
        label(c,"Priority: "+intent.replace('_',' '),14,62,MUTED,12);
        float left=14, top=77, mapSize=Math.min(width-28,183);
        float cx=left+mapSize/2f,cy=top+mapSize/2f,r=mapSize/2f-8;
        fill(c,0xff182537,left,top,left+mapSize,top+mapSize,10);
        paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1f);paint.setColor(GRID);
        for(int i=1;i<=3;i++)c.drawCircle(cx,cy,r*i/3f,paint);
        c.drawLine(cx-r,cy,cx+r,cy,paint);
        c.drawLine(cx,cy-r,cx,cy+r,paint);
        paint.setStyle(Paint.Style.FILL);paint.setColor(GREEN);
        c.drawCircle(cx,cy,5f,paint);
        for(int i=0;i+3<entities.length;i+=4) {
            float dx=entities[i],dz=entities[i+1];
            if(!Float.isFinite(dx)||!Float.isFinite(dz)||
                    Math.hypot(dx,dz)>RANGE)continue;
            paint.setColor(entities[i+2]>=0.5f?RED:
                    entities[i+3]>=0.5f?0xff70b8ff:GOLD);
            c.drawCircle(cx+dx*r/RANGE,cy+dz*r/RANGE,4f,paint);
        }
        float side=left+mapSize+12;
        float sideWidth=Math.max(38,width-side-14);
        label(c,"NEARBY",side,top+12,MUTED,11);
        label(c,"Hostiles: "+threats,side,top+35,threats>0?RED:TEXT,12);
        label(c,"Range: 24m",side,top+54,MUTED,11);
        label(c,"Observed only",side,top+73,MUTED,10);
        label(c,"● Bot",side,top+102,GREEN,11);
        label(c,"● Hostile",side,top+121,RED,11);
        label(c,"● Player",side,top+140,0xff70b8ff,11);
        label(c,"● Other",side,top+159,GOLD,11);
        float y=top+mapSize+21;
        float half=(width-42)/2f;
        bar(c,"HEALTH",health,14,y,half,health>=0&&health<=6?RED:GREEN);
        bar(c,"HUNGER",hunger,28+half,y,half,hunger>=0&&hunger<=6?GOLD:GREEN);
        y+=48;
        label(c,"NEARBY TERRAIN  ·  5 × 5 SAMPLE",14,y,MUTED,11);
        y+=9;
        float total=Math.max(1,walkable+hazards+blocked+unknown), avail=width-28,x=14;
        int[] counts={walkable,hazards,blocked,unknown};
        int[] colors={GREEN,RED,GOLD,GRID};
        for(int i=0;i<4;i++){
            float w=avail*Math.max(0,counts[i])/total;
            if(w>0)fill(c,colors[i],x,y,x+w,y+13,0);
            x+=w;
        }
        y+=31;
        label(c,"Safe "+walkable+"   Hazard "+hazards+"   Blocked "+blocked+
                "   Unknown "+unknown,14,y,TEXT,11);
        y+=21;
        label(c,connected?"No camera feed · No automatic actions":"Awaiting live world data",14,y,MUTED,11);
        c.restore();
    }
}
