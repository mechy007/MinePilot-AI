package ai.minepilot.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.Bundle;
import android.view.View;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;

/**
 * A lightweight software voxel renderer driven ONLY by decoded Bedrock packet
 * observations. This is a reconstructed approximation, not Minecraft video.
 * No OpenGL context, game process, textures or unverified chunk data required.
 */
public final class FirstPersonVoxelView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private float[] blocks = new float[0];   // dx, dy, dz, type
    private float[] actors = new float[0];   // dx, dy, dz, classification
    private float yaw, pitch, eyeHeight = 1.62f;
    private boolean available;
    private String reason = "Waiting for a first-person scene";
    private final ArrayList<Face> faces = new ArrayList<>(1000);
    private static final float NEAR = 0.15f;
    private static final int[] COLORS = {
        0xff627187, 0xff71533b, 0xff858991, 0xff866044, 0xff447c43,
        0xff2b8caf, 0xffff7e30, 0xffc8b076, 0xff67788b
    };
    // Face vertex indices (west, east, bottom, top, north, south)
    private static final int[][] FACES = {
        {0,2,6,4}, {1,5,7,3}, {0,1,3,2},
        {4,6,7,5}, {0,4,5,1}, {2,3,7,6}
    };
    private static final float[][] VERTICES = {
        {0,0,0},{1,0,0},{0,1,0},{1,1,0},
        {0,0,1},{1,0,1},{0,1,1},{1,1,1}
    };
    private static final class Face {
        final Path path;
        final float depth;
        final int color;
        Face(Path path,float depth,int color) {
            this.path=path;this.depth=depth;this.color=color;
        }
    }
    public FirstPersonVoxelView(Context context) { super(context); }
    public void update(Bundle data) {
        available = "spawned".equals(data.getString("phase","")) &&
                data.getBoolean("fp_available", false);
        if (!available) {
            blocks = new float[0];actors=new float[0];
            reason=data.getString("fp_reason","Waiting for decoded blocks and camera rotation");
        } else {
            float[] next=data.getFloatArray("fp_blocks");
            float[] entities=data.getFloatArray("fp_entities");
            blocks=next!=null && next.length<=576 && next.length%4==0?
                    next.clone():new float[0];
            actors=entities!=null && entities.length<=64 && entities.length%4==0?
                    entities.clone():new float[0];
            yaw=data.getFloat("fp_yaw",0f);
            pitch=Math.max(-89,Math.min(89,data.getFloat("fp_pitch",0f)));
            eyeHeight=1.62f;
            reason="Decoded scene: "+(blocks.length/4)+" voxels";
        }
        invalidate();
    }
    private float[] project(float x,float y,float z,float width,float height) {
        double angle=Math.toRadians(yaw);
        float s=(float)Math.sin(angle), c=(float)Math.cos(angle);
        float horizontal=x*c+z*s;
        float depth=-x*s+z*c;
        double tilt=Math.toRadians(pitch);
        float sy=(float)(y*Math.cos(tilt)+depth*Math.sin(tilt));
        float sz=(float)(depth*Math.cos(tilt)-y*Math.sin(tilt));
        if (sz<=NEAR) return null;
        float focal=width*0.94f;
        float px=width/2+horizontal*focal/sz;
        float py=height/2-sy*focal/sz;
        if (!Float.isFinite(px)||!Float.isFinite(py))return null;
        return new float[]{px,py,sz};
    }
    private static int shade(int color,float ratio) {
        return Color.rgb(Math.min(255,(int)(Color.red(color)*ratio)),
                Math.min(255,(int)(Color.green(color)*ratio)),
                Math.min(255,(int)(Color.blue(color)*ratio)));
    }
    private void buildFaces(int index,float width,float height) {
        float bx=blocks[index], by=blocks[index+1]-eyeHeight, bz=blocks[index+2];
        int type=Math.max(1,Math.min(COLORS.length-1,(int)blocks[index+3]));
        float[][] projected=new float[8][];
        for(int v=0;v<8;v++) {
            float[] corner=VERTICES[v];
            projected[v]=project(bx+corner[0],by+corner[1],bz+corner[2],width,height);
        }
        for(int f=0;f<FACES.length;f++) {
            Path path=new Path();
            boolean visible=true;
            float depth=0;
            for(int j=0;j<4;j++){
                float[] p=projected[FACES[f][j]];
                if(p==null){visible=false;break;}
                if(j==0)path.moveTo(p[0],p[1]);else path.lineTo(p[0],p[1]);
                depth+=p[2];
            }
            if(!visible)continue;
            path.close();
            // Fixed lighting for legibility, not a simulation of sky lighting.
            float brightness=f==3?1.18f:f==2?0.58f:f==4?0.88f:f==5?0.76f:0.66f;
            faces.add(new Face(path,depth/4f,shade(COLORS[type],brightness)));
        }
    }
    private void text(Canvas canvas,String message,float x,float y,int color,float size){
        paint.setColor(color);paint.setStyle(Paint.Style.FILL);
        paint.setTextSize(size);
        canvas.drawText(message,x,y,paint);
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w=getWidth(),h=getHeight(),density=getResources().getDisplayMetrics().density;
        canvas.drawColor(0xff172839);
        if(!available){
            text(canvas,"FIRST PERSON · RECONSTRUCTED",12*density,22*density,0xff65e4ad,12*density);
            text(canvas,reason,12*density,h/2,0xffc0cee0,12*density);
            text(canvas,"No synthetic terrain is displayed",12*density,h/2+24*density,
                    0xff9fb0ca,11*density);
            return;
        }
        faces.clear();
        for(int i=0;i+3<blocks.length;i+=4)
            buildFaces(i,w,h);
        Collections.sort(faces,Comparator.comparingDouble((Face face)->face.depth).reversed());
        for(Face face:faces){
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(face.color);
            canvas.drawPath(face.path,paint);
        }
        // Entity billboards are intentionally approximate markers: no model data.
        ArrayList<float[]> markers=new ArrayList<>();
        for(int i=0;i+3<actors.length;i+=4){
            float[] point=project(actors[i],actors[i+1]-0.65f,actors[i+2],w,h);
            if(point!=null)markers.add(new float[]{point[0],point[1],point[2],actors[i+3]});
        }
        markers.sort((a,b)->Float.compare(b[2],a[2]));
        for(float[] marker:markers){
            if(marker[0]<0||marker[0]>w||marker[1]<0||marker[1]>h)continue;
            paint.setColor(marker[3]==2?0xffff7585:marker[3]==1?0xff70b8ff:0xffffc07a);
            paint.setStyle(Paint.Style.FILL);
            float radius=Math.max(3*density,Math.min(12*density,26*density/marker[2]));
            canvas.drawCircle(marker[0],marker[1],radius,paint);
        }
        paint.setColor(0xff65e4ad);
        paint.setStrokeWidth(1.4f*density);
        canvas.drawLine(w/2-8*density,h/2,w/2+8*density,h/2,paint);
        canvas.drawLine(w/2,h/2-8*density,w/2,h/2+8*density,paint);
        paint.setColor(0xff142133);
        paint.setStyle(Paint.Style.FILL);
        canvas.drawRect(0,0,w,37*density,paint);
        text(canvas,"FIRST PERSON  ·  VOXEL RECONSTRUCTION",10*density,15*density,
                0xff65e4ad,11*density);
        text(canvas,"Yaw "+Math.round(yaw)+"° · Pitch "+Math.round(pitch)+
                "°  ·  "+(blocks.length/4)+" observed cubes",10*density,31*density,
                0xffd3dce7,10*density);
        text(canvas,"Unknown blocks hidden · Textures and lighting approximated",
                8*density,h-10*density,0xffcad5e3,9*density);
    }
}
