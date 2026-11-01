// Called after each scenery vertex has its final spherical direction. Only
// the lowest chalk ring forms a skirt; caps, ledges and planted roots keep
// their authored heights. A small overlap hides bake/mesh approximation gaps.
#include <meadow_terrain>
float canyonGroundedHeight(vec3 dir, float height, float kind, float localY) {
  if(kind>1.5&&kind<2.5&&localY<=-0.1) {
    return min(height,height0(dir)+uBank.x-0.18);
  }
  return height;
}
